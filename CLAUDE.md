# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

ShopMind: multimodal product retrieval (A1) over a 1,500-product Amazon Berkeley Objects subset, plus a multi-source RAG answer layer (A3) over products, Amazon reviews, and experimental store policies. Stack: FastAPI, Elasticsearch 8.15 (BM25 + dense kNN), a dedicated multilingual text embedder (E5, `text_vector`) plus SigLIP2 for images and cross-modal (`image_vector`), config-declared search/RAG pipelines with a glass-box trace, PostgreSQL/SQLite system of record (admin, traces, feedback, jobs), OpenAI Responses API (or Ollama) for answers. The refactor plan and its status are in `docs/REFACTOR_PLAN.md`. This is a monorepo: the Python API is in `api/`, the React + Vite UI is in `ui/` (built by `docker compose` as the `frontend` service). `docker-compose.yml` and `.env` stay at the repo root.

## Commands

Python commands run from `api/`; UI commands (`npm test`, `npm run build`) run from `ui/`. `docker compose` works from either, because it finds the root `docker-compose.yml`.

```bash
python -m pip install -e '.[dev]'            # add '.[rag-rerank]' for the cross-encoder reranker
docker compose up -d elasticsearch           # ES on :9200; full stack: docker compose up -d --build api frontend

# Fast tests (no Elasticsearch, no real model)
pytest tests/unit tests/api tests/evaluation tests/a3 tests/platform -q
pytest tests/unit/test_bm25_retriever.py::test_bm25_maps_hits_to_ranked_results -q   # single test

pytest tests/integration -m integration -q   # needs Elasticsearch running
RUN_SLOW_MODEL_TESTS=1 pytest -m slow -q     # downloads/loads real SigLIP2

ruff check shopmind evaluation scripts tests # lint (pyflakes rules only; see pyproject)
```

All scripts and evaluation entry points run as modules from `api/`: `python -m scripts.<name>`, `python -m evaluation.runner`, `python -m evaluation.ablation`, `python -m scripts.run_rag_experiment`.

**Run anything that loads SigLIP2 (embedding generation, evaluation) inside the Docker runtime on CPU** on macOS (host Python 3.13 + MPS crashes while loading the model); on Windows/Linux hosts the CPU path works directly (set `PYTHONUTF8=1` on Windows). Pattern:

```bash
docker compose run --rm -T --no-deps -v "$PWD:/app" -e ELASTICSEARCH_URL=http://elasticsearch:9200 \
  api python -u -m <module> ... --device cpu
```

Full A1 rebuild/eval and A3 indexing command sequences are in `api/README.md` and the root `Makefile` (`make embed index embedding-map index-policies eval-a1 eval-compose`); reuse them rather than reconstructing flags. Local run without Docker: Elasticsearch on :9200, then `make dev-api` (dev profile: SQLite, `admin`/`admin`) and `make dev-ui`; `python -m scripts.seed_demo` creates users, policy CMS rows and the synthetic price/stock overlay.

## Architecture

**Layout (Clean Architecture):** `shopmind/domain` (models, no framework imports) ← `shopmind/application` (retrieval, search, catalog, knowledge, rag, chat, pipeline engine) ← `shopmind/interfaces/http` (routes, schemas, deps, SSE, error map); `shopmind/infrastructure` (elasticsearch, embedding, llm, db adapters); `shopmind/core` (config, registry, tracing, logging); `shopmind/bootstrap` (composition root); `shopmind/ingestion` (offline pipeline). Contract for HTTP shapes: `docs/API_CONTRACT.md`.

**Platform rules:** components register with `shopmind.core.registry.register(kind, name)` and are chosen by name in YAML. Pipelines (`config.pipelines`) are lists of steps resolved as `step.<impl>` (`register_step`) and run by `application/pipeline/engine.py` inside `core/tracing.trace_step`, which builds the glass-box trace. Wiring lives in one module per subsystem under `shopmind/bootstrap/wiring/` (`ORDER`, `CRITICAL`, `LIGHTWEIGHT`, `wire(container)`), auto-discovered; routers in `interfaces/http/routes/` exposing `router` are auto-mounted; map exceptions with `interfaces/http/errors.register_error`. Config layering: `configs/app.yaml` → `configs/profiles/$SHOPMIND_PROFILE.yaml` → legacy env vars → `SHOPMIND__SECTION__KEY` env → runtime admin overrides (`core/config.apply_overrides`).


**Offline pipeline is split into separate stages, each producing an artifact:** `scripts.prepare_a1_abo_subset` → `data/a1_abo_1500/products.jsonl` (canonical schema, see `shopmind/ingestion/`) → `scripts.generate_embeddings` (SigLIP2 text+image → `data/embeddings/abo_a1_1500_v1/`; `--embedder text_e5` → text-only `..._text_e5/`, rendered with the embedder's `document_template`) → `scripts.create_index --text-manifest` + `scripts.index_products --text-embeddings` (E5 → `text_vector`, SigLIP2 → `image_vector` + `siglip_text_vector`, per-field identity in the mapping `_meta`). Re-indexing never re-runs a model. `scripts.build_embedding_map` writes the 2D PCA maps. A3 mirrors this with `generate_knowledge_embeddings` (embedder from `indexes.<source>s.vectors`) + `index_reviews` / `index_policies`.

**Index versioning:** physical indexes are versioned (`products_a1_1500_v2`, `reviews_a3_v1`, `policies_a3_v1`); the app only reads the stable aliases `products`, `reviews`, `policies`. Index scripts validate doc count, vector dims, BM25 and kNN smoke searches before atomically switching the alias. Never hard-code a physical index name in app code.

**Runtime wiring:** `create_app(...)` (`shopmind/main.py`) runs `bootstrap/container.build_container`, which imports every `bootstrap/wiring/*` module (database → auth → config_service → platform services → tracing → search → rag → pipelines → jobs → hot_reload). `search` is CRITICAL (failure → `/ready` 503, `/health` stays up); the rest degrade per feature. Routes read components with `interfaces/http/deps.component(request, name)`. Admin config changes go through `config_service` (hot-reloadable keys only) and `wiring/hot_reload.py` rebuilds pipelines and the RAG service without a restart. API tests use fakes via `create_app(..., auto_wire=False)` (see `tests/api/conftest.py`), which runs only the LIGHTWEIGHT wiring modules.

**Runtime performance:** embedders are wrapped in `infrastructure/embedding/cache.CachingEmbedder` (LRU for single query texts and images keyed by pixel hash; batches and ingestion bypass it); the product repository caches catalog filter resolution (5 min) and the alias → index mapping; the engine runs consecutive `retrieve` steps concurrently and merges them in declaration order (`application/pipeline/engine.py`, `PARALLEL_STEPS`).

**A1 retrieval** runs as pipelines declared in `configs/pipelines/search.yaml` (`search.bm25`, `search.dense` (E5), `search.hybrid` (RRF), `search.hybrid_linear` (default for `mode=hybrid`, chosen on the accuracy_v2 DEV split), `search.adaptive`, `search.cross_modal`, `search.image`, `search.compose` (F1), `search.similar`, plus eval-only ones). Steps are in `application/search/steps.py` (`query_understanding.rules`, `retrieve.bm25`, `retrieve.dense` with `field`/`input`/`embedder` params, `fuse.rrf|linear` with weights, `rerank.noop|cross_encoder|attribute_boost`, `compose_query.weighted_sum`); `search/service.py::SearchService` maps modes to pipelines (`defaults.mode.*`) and still accepts injected retrievers for legacy tests. The retriever classes in `application/retrieval/` remain as building blocks. ES query building, highlight/DSL capture (only when `explain`), facets, suggest and catalog-resolved filters live in `infrastructure/elasticsearch/repository.py`. Filter semantics: OR within brand/category/color, AND across fields; exact catalog match first, substring/prefix fallback only for values absent from the catalog; exact filters are never broadened. Aliases (vi/en categories and colours) come from `configs/vocab/*.yaml`.

**A3 RAG** (`shopmind/application/rag/service.py::RAGService`): `MultiSourceRetriever` (`knowledge/`: product retriever wraps A1 `SearchService`; review/policy retrievers query their own indexes) → per-source rankings fused with `rag/fusion.py` (`rrf` or `concat`) → optional cross-encoder `rag/reranker.py` → `rag/context.py` budgets the context per source → LLM (`infrastructure/llm/openai_provider.py`, structured output) → `rag/citations.py` validates that cited IDs came from the exact context sent (one retry on invalid citations) and resolves source metadata. Missing source index → 503; index present but no evidence → abstain (`insufficient_evidence`). Each stage records a trace step (`multi_source_retrieve`, `fuse`, `rerank`, `build_context`, `generate_N`, `validate_N`). Prompts are versioned files in `configs/prompts/` (`infrastructure/llm/prompts.py`); LLM providers register under kind `llm` (`openai`, `ollama`). The chat assistant (`application/chat/`) routes intents first (`intents.py`, rules or catalog-constrained LLM): `product_search`/`compare` answer with product cards without an LLM call, `chitchat` with help text, questions go through rewrite + RAG. `rag/compare.py` (F3) builds the attribute table from catalog data and a cited comparison. `rag/planner.py` (F6, `POST /rag/plan`, chat intent `shopping_plan`) decomposes a situation into needs (LLM constrained to catalog categories, or `configs/vocab/occasions.yaml`), retrieves per need through `defaults.search`, picks a basket with an exact budget DP over the synthetic prices, and justifies each pick with validated citations (extractive fallback without an LLM). The storefront sends no search `mode`: `defaults.search` (admin, hot-reloadable) decides; glass-box views are admin-only in the UI. `adaptive` is a small rule (identifier-like query → BM25, descriptive → dense, mixed → hybrid), not a learned classifier.

Note there are two parallel fusion/reranker modules: `retrieval/` operates on A1 `SearchResult`, `rag/` operates on A3 `RetrievedDocument`.

## Evaluation and experiments

- A1: `configs/experiments/*.yaml` are full run configs consumed by `evaluation.runner` / `evaluation.ablation`; `retrieval.pipeline` selects a configured pipeline and a top-level `pipeline: {steps: [...]}` is an inline overlay registered for that run. Run them with `SHOPMIND_PROFILE=eval`. Benchmarks: `evaluation/benchmarks/a1/{queries,qrels}.jsonl` (seed 42, generated by `scripts.build_a1_benchmark`; its image queries need `evaluation/benchmarks/a1/images/`, regenerated by the same script) and `evaluation/benchmarks/accuracy_v2/` (DEV/holdout splits: select on DEV, report holdout once). Do not hand-edit. Metrics: Recall@10, nDCG@10, MRR@10. F1: `python -m evaluation.compose` (synthetic labels from metadata).
- `hybrid_no_rrf` is evaluation-only (isolates RRF's contribution); it is intentionally **not** a public `SearchMode`.
- A3: `configs/experiments/rag/*.yaml` may only contain `experiment`, `sources`, `rag` keys and are **overlays** merged section-by-section onto the base `RAGConfig` (`evaluation/rag/runner.py::load_experiment_config`). `s0`–`s5` are a controlled progression (BM25 → dense → hybrid → +rerank → +generation → adaptive+generation). `s0`–`s3` do not call the LLM; `s4`–`s5` need `OPENAI_API_KEY`; `s3`–`s5` need the `rag-rerank` extra.
- Every run writes `runs/<timestamp>_<name>/` with `config.yaml`, `metrics.json`, `results.jsonl`, `errors.jsonl`, `summary.md`. `runs/`, `data/` subsets, embeddings, and `data/evaluation/` are git-ignored generated outputs.
- Reports in `reports/` must reflect `metrics.json` numbers. The A3 seed cases and policies are placeholders: do not present them as measured answer quality. Qrels still need human review before results are reported.

## Conventions

- Config models in `shopmind/core/config.py` use `extra="forbid"`: adding a key to `configs/app.yaml` or an experiment overlay requires adding it to the Pydantic model.
- Pytest markers: `integration` (real Elasticsearch), `slow` (large models; also gated by `RUN_SLOW_MODEL_TESTS=1`).
- Image bytes and embedding vectors must never be written to structured search logs, traces or the database (`core/tracing.sanitize` keeps only `{dims, norm}` summaries). Public search results expose only `product_id`, `title`, `image_url`, `brand`, `category`, `score`, `rank`; per-component scores and the step trace are available via `explain: true` (inline trace) or `POST /api/v1/debug/search` (JWT).
- Generated files that tests byte-compare (benchmarks, `products.jsonl`) are written with LF and POSIX paths (`.gitattributes` keeps them LF on checkout).
- `data/processed/products.jsonl` is a four-row sample; use `data/a1_abo_1500/products.jsonl` for real work.
