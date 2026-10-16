# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

ShopMind: multimodal product retrieval (A1) over a 1,500-product Amazon Berkeley Objects subset, plus a multi-source RAG answer layer (A3) over products, Amazon reviews, and experimental store policies. Stack: FastAPI, Elasticsearch 8.15 (BM25 + dense kNN), SigLIP2 (`google/siglip2-base-patch16-224`) for text and image embeddings, RRF fusion, OpenAI Responses API for answers. This is a monorepo: the Python API is in `api/`, the React + Vite UI is in `ui/` (built by `docker compose` as the `frontend` service). `docker-compose.yml` and `.env` stay at the repo root.

## Commands

Python commands run from `api/`; UI commands (`npm test`, `npm run build`) run from `ui/`. `docker compose` works from either, because it finds the root `docker-compose.yml`.

```bash
python -m pip install -e '.[dev]'            # add '.[rag-rerank]' for the cross-encoder reranker
docker compose up -d elasticsearch           # ES on :9200; full stack: docker compose up -d --build api frontend

# Fast tests (no Elasticsearch, no real model)
pytest tests/unit tests/api tests/evaluation tests/a3 -q
pytest tests/unit/test_bm25_retriever.py::test_bm25_maps_hits_to_ranked_results -q   # single test

pytest tests/integration -m integration -q   # needs Elasticsearch running
RUN_SLOW_MODEL_TESTS=1 pytest -m slow -q     # downloads/loads real SigLIP2

ruff check shopmind evaluation scripts tests # lint (pyflakes rules only; see pyproject)
```

All scripts and evaluation entry points run as modules from `api/`: `python -m scripts.<name>`, `python -m evaluation.runner`, `python -m evaluation.ablation`, `python -m scripts.run_rag_experiment`.

**Run anything that loads SigLIP2 (embedding generation, evaluation) inside the Docker runtime on CPU**, not on the host: the host Python 3.13 + MPS crashes while loading the model. Pattern:

```bash
docker compose run --rm -T --no-deps -v "$PWD:/app" -e ELASTICSEARCH_URL=http://elasticsearch:9200 \
  api python -u -m <module> ... --device cpu
```

Full A1 rebuild/eval and A3 indexing command sequences are in `api/README.md`; reuse them rather than reconstructing flags.

## Architecture

**Offline pipeline is split into separate stages, each producing an artifact:** `scripts.prepare_a1_abo_subset` → `data/a1_abo_1500/products.jsonl` (canonical schema, see `shopmind/pipeline/`) → `scripts.generate_embeddings` → `data/embeddings/<version>/` (`product_ids.json`, `text_embeddings.npy`, `image_embeddings.npy`, `manifest.json`) → `scripts.create_index` + `scripts.index_products`. Re-indexing never requires re-running SigLIP2. A3 mirrors this with `generate_knowledge_embeddings` + `index_reviews` / `index_policies`.

**Index versioning:** physical indexes are versioned (`products_a1_1500_v1`, `reviews_a3_v1`, `policies_a3_v1`); the app only reads the stable aliases `products`, `reviews`, `policies`. Index scripts validate doc count, vector dims, BM25 and kNN smoke searches before atomically switching the alias. Never hard-code a physical index name in app code.

**Runtime wiring** is in `shopmind/app/main.py`: `create_app(...)` accepts injected `search_service`, `repository`, `embedder`, `rag_service`; with `auto_wire=True` the lifespan hook builds real ones from `configs/app.yaml` (override with `SHOPMIND_CONFIG`). Init failures are stored on `app.state.runtime_error` / `rag_runtime_error` rather than crashing, so `/health` stays up while `/ready` and RAG return 503. API tests use fakes via `create_app(..., auto_wire=False)` (see `tests/api/conftest.py`). Domain exceptions map to HTTP codes in `main.py`'s exception handlers.

**A1 retrieval** (`shopmind/app/retrieval/`): `BM25Retriever`, `TextDenseRetriever` (text→`text_vector`), `CrossModalRetriever` (text→`image_vector`), `ImageDenseRetriever`, and `HybridRetriever` (BM25 + dense → `rrf_fuse` in `retrieval/fusion.py` → reranker boundary, currently `NoOpReranker`), all composed by `search/service.py::SearchService`. The ES query building and catalog-resolved filter logic live in `infrastructure/elasticsearch/repository.py`. Filter semantics: OR within brand/category, AND across fields; exact catalog match first, substring/prefix fallback only for values absent from the catalog; exact filters are never broadened.

**A3 RAG** (`shopmind/app/rag/service.py::RAGService`): `MultiSourceRetriever` (`knowledge/`: product retriever wraps A1 `SearchService`; review/policy retrievers query their own indexes) → per-source rankings fused with `rag/fusion.py` (`rrf` or `concat`) → optional cross-encoder `rag/reranker.py` → `rag/context.py` budgets the context per source → LLM (`llm/openai_provider.py`, structured output) → `rag/citations.py` validates that cited IDs came from the exact context sent (one retry on invalid citations) and resolves source metadata. Missing source index → 503; index present but no evidence → abstain (`insufficient_evidence`). `adaptive` retrieval mode is a small rule (identifier-like query → BM25, descriptive → dense, mixed → hybrid), not a learned classifier; default stays `hybrid`.

Note there are two parallel fusion/reranker modules: `retrieval/` operates on A1 `SearchResult`, `rag/` operates on A3 `RetrievedDocument`.

## Evaluation and experiments

- A1: `configs/experiments/*.yaml` are full run configs consumed by `evaluation.runner` / `evaluation.ablation`; benchmark is `evaluation/benchmarks/a1/{queries,qrels}.jsonl` (seed 42, generated by `scripts.build_a1_benchmark`; do not hand-edit). Metrics: Recall@10, nDCG@10, MRR@10.
- `hybrid_no_rrf` is evaluation-only (isolates RRF's contribution); it is intentionally **not** a public `SearchMode`.
- A3: `configs/experiments/rag/*.yaml` may only contain `experiment`, `sources`, `rag` keys and are **overlays** merged section-by-section onto the base `RAGConfig` (`evaluation/rag/runner.py::load_experiment_config`). `s0`–`s5` are a controlled progression (BM25 → dense → hybrid → +rerank → +generation → adaptive+generation). `s0`–`s3` do not call the LLM; `s4`–`s5` need `OPENAI_API_KEY`; `s3`–`s5` need the `rag-rerank` extra.
- Every run writes `runs/<timestamp>_<name>/` with `config.yaml`, `metrics.json`, `results.jsonl`, `errors.jsonl`, `summary.md`. `runs/`, `data/` subsets, embeddings, and `data/evaluation/` are git-ignored generated outputs.
- Reports in `reports/` must reflect `metrics.json` numbers. The A3 seed cases and policies are placeholders: do not present them as measured answer quality. Qrels still need human review before results are reported.

## Conventions

- Config models in `shopmind/app/core/config.py` use `extra="forbid"`: adding a key to `configs/app.yaml` or an experiment overlay requires adding it to the Pydantic model.
- Pytest markers: `integration` (real Elasticsearch), `slow` (large models; also gated by `RUN_SLOW_MODEL_TESTS=1`).
- Image bytes and embedding vectors must never be written to structured search logs. Public search results expose only `product_id`, `title`, `image_url`, `brand`, `category`, `score`, `rank`; per-component scores are available only via `POST /api/v1/debug/search`.
- `data/processed/products.jsonl` is a four-row sample; use `data/a1_abo_1500/products.jsonl` for real work.
