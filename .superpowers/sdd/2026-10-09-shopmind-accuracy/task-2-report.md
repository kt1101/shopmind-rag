# Task 2: measured embedding/retrieval accuracy

**Status:** implementation complete; candidate qualified on measured gates; product alias activation awaits independent review. Old artifacts/index and frozen benchmark remain unchanged.

**Source:** backend branch `codex/accuracy-improvement`, base `798b5d974555f71677c57469fb0cce25e2902350`. Candidate code/config SHA256 values are in `runs/accuracy/final_measurements.json` (`source_files_sha256`). This report and owned code are committed together as `fix: stabilize embeddings and retrieval accuracy`.

## Changes and shared contracts

- SigLIP2 indexing/query text uses fixed `padding=max_length`, `max_length=64`, `truncation=true`; runtime and both generation CLIs propagate the configured cached model revision `75de2d55ec2d0b4efc50b3e9ad70dba96a7b2fa2`. The provider records the resolved model commit.
- Product/knowledge manifests add preprocessing identity; archive loading still accepts old manifests. New index mappings record model, revision, dimension, normalization and modality preprocessing. Unknown/mismatched identity is rejected before corrected vector queries or artifact bulk writes. Numerical checks reject wrong shape/dimension, nonfinite/zero text vectors and invalid provider features. Missing image zero sentinels remain valid in artifacts and omitted from indexing.
- Runtime/retrievers resolve and validate one physical index, then use that same concrete target. An alias change cannot redirect a validated repository. Product/knowledge bulk writes validate dimensions and document model/revision against index metadata. Active aliased indexes cannot be recreated.
- Exact product ID lookup precedes hybrid fusion, honors filters and handles lowercase IDs. A3 exact selected-product linkage and A1 partial-filter semantics remain covered by tests. Exact-ID debug traces report no invented dense/RRF contribution.
- Independent static lexical vocabulary translates ordinary Vietnamese category/color terms and English category plurals; common exact European color metadata gains canonical color terms during indexing. This module imports no evaluation data, qrels, query intent or product target. DEV errors motivated the vocabulary. Original API queries and literal IDs remain intact.
- Development selected hybrid with `lexical_preserving=true`, RRF k=60, top_k=10, candidate_k=100. The setting applies to actual runtime hybrid, omitted API mode (existing hybrid default), explicit hybrid mode and the A3 product hybrid retriever. Debug metadata exposes `ordering_policy` (`exact_id`, `rrf`, or `lexical_preserving`); scores remain retrieval signals.

## Real model and corpus evidence

Docker CPU only; cached `test-api:latest` image `sha256:60b2f93d954b856774f946b6b1daa1b6a2d022ba454e68a9a1dd999d1f2111c0`, Elasticsearch 8.15.3. `runs/accuracy/docker_runtime_versions.json` records torch 2.14.0+cu130, transformers 4.57.6, numpy 2.5.3, Elasticsearch Python 8.19.3 and CUDA unavailable. Four CPU threads were used.

- Actual six-probe diagnostic covers short/long English, Vietnamese, punctuation and product ID. Dynamic padding minimum cosine: **0.54245919**. Fixed padding minimum cosine: **0.9999997616**; maximum L2 difference **0.0**. Actual standalone/mixed vectors and identities: `runs/accuracy/batch_diagnostic.json`.
- Both 1,500×768 matrices were regenerated into `data/embeddings/abo_accuracy_v2`; all vectors finite, all rows nonzero. Images were actually regenerated with the pinned model and recorded image processor/config. Old image revision remains unknown; no legacy image provenance was invented.
- New physical index `products_accuracy_20261009_v2`: 1,500 documents, matching full catalog ID set, dimensions and identities. Old `products_a1_1500_v1`: 1,500 documents, retained unchanged. Snapshots and canonical source/vector hashes: `runs/accuracy/products_a1_1500_v1_snapshot.json`, `runs/accuracy/products_accuracy_20261009_v2_snapshot.json`.

## Development choice, frozen before holdout

All four choices used the same 130 development queries (102 natural-language rows = 51 bilingual intents; 28 exact IDs). All requests succeeded. BM25 and lexical-preserving hybrid tie on all primary metrics; the existing public hybrid mode was retained. No measured semantic quality advantage over BM25 is claimed. Equal RRF and corrected dense were weaker.

| DEV choice | nDCG@10 | Recall@10 | MRR@10 |
|---|---:|---:|---:|
| bm25 | 0.663563 | 0.772448 | 0.637277 |
| hybrid | 0.361680 | 0.488520 | 0.365601 |
| dense | 0.012602 | 0.013333 | 0.024432 |
| lexical | 0.663563 | 0.772448 | 0.637277 |

**Freeze:** `runs/accuracy/selection.json`, timestamp `2026-10-09T16:40:31.055368+00:00`; config/vocabulary/benchmark hashes remain unchanged after the freeze. Candidate holdout ran once using that choice. No holdout tuning followed.

## Holdout quality

Holdout has **30 rows: 18 natural-language rows (9 English + 9 Vietnamese, 9 bilingual intents), plus 12 exact IDs**. Labels are frozen metadata predicates, not human semantic judgments. Every attempted benchmark request contributes to the quality denominator; all baseline/candidate runs have zero query failures.

| HOLDOUT mode | nDCG@10 | Recall@10 | MRR@10 | Exact-ID top1 |
|---|---:|---:|---:|---:|
| old deployed hybrid | 0.370035 | 0.466667 | 0.337500 | 50% |
| old strongest BM25 | 0.525510 | 0.600000 | 0.502910 | 100% |
| old dense | 0.000000 | 0.000000 | 0.000000 | 0% |
| frozen candidate hybrid | 0.607537 | 0.666667 | 0.588095 | 100% |

**Target met on this benchmark:** nDCG improvement **+0.237503** over old deployed hybrid and **+0.082028** over old strongest BM25 (both exceed +0.05). Recall/MRR increase against both baselines. The overall holdout Recall@10 ceiling is 1.0.

Natural-language rows exclude all exact-ID probes:

| HOLDOUT language (9 rows each) | old hybrid nDCG / Recall / MRR | old BM25 nDCG / Recall / MRR | candidate nDCG / Recall / MRR |
|---|---|---|---|
| en | 0.035052 / 0.111111 / 0.013889 | 0.270218 / 0.444444 / 0.216049 | 0.362429 / 0.444444 / 0.333333 |
| vi | 0.111111 / 0.111111 / 0.111111 | 0.148148 / 0.222222 / 0.126984 | 0.329363 / 0.444444 / 0.293651 |

- Corrected candidate exact IDs: DEV 28/28 plus holdout 12/12. Actual HTTP smoke additionally checked all 40 frozen IDs in lowercase in each of BM25/hybrid (80/80 top1) and two filter exclusion requests. `runs/accuracy/live_api_smoke.json` and `runs/accuracy/holdout.log` record these checks.
- Existing 20 A1 image identity probes: old and new each Recall/nDCG/MRR=1.0, 20/20 successful. This establishes identity retrieval preservation, not independent visual relevance.
- Corrected dense DEV nDCG remains only 0.012602: fixed batching cures the vector inconsistency; this SigLIP2 text model still has weak semantic retrieval on the metadata benchmark.
- Real LLM semantic answer accuracy = **null**; real review answer accuracy = **null** (no configured key/real review evaluation). Unit/API fixtures and retrieval metrics do not establish those values.

## Raw runs and hashes

Each directory below retains original `results.jsonl`, `errors.jsonl`, `metrics.json`, `config.yaml` and `summary.md`. Supplemental `runtime_identity.json` distinguishes query cached commit from unknown legacy index revision. Existing runner metadata in exploratory runs reports embedding identity as unknown because the injected service lacked those attributes; the supplemental identity/provenance records the actual source/cache/index and does not rewrite rankings. The frozen holdout runtime carries explicit known embedding metadata.

- `baseline_dev_bm25`: `runs/accuracy/20261009T114540Z_baseline_dev_bm25`
- `baseline_dev_hybrid`: `runs/accuracy/20261009T114545Z_baseline_dev_hybrid`
- `baseline_dev_dense`: `runs/accuracy/20261009T114625Z_baseline_dev_dense`
- `baseline_holdout_bm25`: `runs/accuracy/20261009T114645Z_baseline_holdout_bm25`
- `baseline_holdout_hybrid`: `runs/accuracy/20261009T114646Z_baseline_holdout_hybrid`
- `baseline_holdout_dense`: `runs/accuracy/20261009T114653Z_baseline_holdout_dense`
- `candidate_dev_bm25`: `runs/accuracy/20261009T163716Z_candidate_dev_bm25`
- `candidate_dev_hybrid`: `runs/accuracy/20261009T163733Z_candidate_dev_hybrid`
- `candidate_dev_dense`: `runs/accuracy/20261009T163817Z_candidate_dev_dense`
- `candidate_dev_lexical`: `runs/accuracy/20261009T163848Z_candidate_dev_lexical`
- `candidate_baseline_image`: `runs/accuracy/20261009T163935Z_baseline_image`
- `candidate_candidate_image`: `runs/accuracy/20261009T163950Z_candidate_image`
- `candidate_holdout_winner`: `runs/accuracy/20261009T164219Z_frozen_winner_holdout`

**Complete comparison/provenance for Task 4:** `runs/accuracy/final_measurements.json` (per-run metrics, all raw artifact hashes, code/config hashes, index snapshots, benchmark hashes, null semantic measurements); `runs/accuracy/final_comparison.log`; `runs/accuracy/baseline_provenance.json`; `runs/accuracy/baseline_source_hashes.json`; `runs/accuracy/candidate_provenance.json`; `runs/accuracy/candidate_artifact_hashes.json`.

| Frozen file | SHA256 |
|---|---|
| `evaluation/benchmarks/accuracy_v2/queries.jsonl` | `a9ad335e7ca8c830322f58de74d8733bc937853fadd154592554edb188362844` |
| `evaluation/benchmarks/accuracy_v2/qrels.jsonl` | `d2fa9c41bccfe35969b8cb0d67048d0a92c0d6640db5bd55e80d8df388b11d99` |
| `evaluation/benchmarks/accuracy_v2/manifest.json` | `09326307ab61dbb882f182777e5b5aa26b14da2a6d6807ccf1e1029df259c5b7` |
| `data/a1_abo_1500/products.jsonl` | `addc2b80493d9bda334af1130aabab401f4287806324f56b55c8a7cfc87472e4` |

New artifact hashes:

- `image_embeddings.npy`: `c4862953053a32f104b12899115d4151c7f1f87b710cd19af991740ac229baf0`
- `text_embeddings.npy`: `44951d3afce966ca10bb7117e05cf064929175261d1df61e5913eeaf524ff8ec`
- `manifest.json`: `fee00a21ae1d885bcf823eda88117ef47c155c8b0984be331008d1c28c78fad4`
- `product_ids.json`: `954e6d8b8622907e9ef4c2062cdab926edbfbce43f8c96d0f3f0e8c09b19c606`
- `cached_docker_image`: `sha256:60b2f93d954b856774f946b6b1daa1b6a2d022ba454e68a9a1dd999d1f2111c0`

## Commands and reproducibility

Actual orchestration commands/logs:

```sh
docker start test-elasticsearch-1
# Docker CPU, repo mounted /app, HF cache mounted /root/.cache/huggingface, HF_HUB_OFFLINE=1, PYTHONPATH=/app, OMP_NUM_THREADS=4, MKL_NUM_THREADS=4
python runs/accuracy/measure.py baseline products_a1_1500_v1
python -m scripts.diagnose_embedding_accuracy --output runs/accuracy/batch_diagnostic.json
python -m scripts.generate_embeddings --input data/a1_abo_1500/products.jsonl --output-dir data/embeddings/abo_accuracy_v2 --dataset-version abo_accuracy_v2 --device cpu
python -m scripts.create_index --artifacts-dir data/embeddings/abo_accuracy_v2 --index-name products_accuracy_20261009_v2
python -m scripts.index_products --products data/a1_abo_1500/products.jsonl --artifacts-dir data/embeddings/abo_accuracy_v2 --index-name products_accuracy_20261009_v2
python runs/accuracy/measure.py candidate products_accuracy_20261009_v2
python runs/accuracy/holdout_and_smoke.py
python -m pytest -q
python -m ruff check shopmind scripts tests
git diff --check
```

Logs: `baseline.log`, `regenerate.log`, `candidate.log`, `holdout.log`, `final_tests.log`, `final_lint.log`, all under `runs/accuracy/`. Regression red evidence: `red_tests.log` (7 expected failures), `lexical_red.log`, `lexical_candidates_red.log`. Final pytest: **175 passed, 1 skipped**; optional slow model test skipped, covered separately by actual Docker CPU probe/regeneration. Correctness lint and whitespace checks pass.

The first holdout launcher failed importing optional Docker TestClient/httpx2 **before any benchmark request**. `runs/accuracy/holdout_startup_failure.log` is retained; the successful smoke used actual uvicorn plus Python standard-library HTTP, adding no dependency. The only measured winner holdout is the run listed above.

The following reproduction uses tracked modules directly and needs no ignored `measure.py`. From the repository root, the existing qualified physical index can be measured on a chosen split. A reproduction creates a new run directory; it does not replace frozen selection results:

```sh
docker run --rm -i \
  -v "$PWD:/app" -v /Users/yuji/.cache/huggingface:/root/.cache/huggingface \
  -w /app -e HF_HUB_OFFLINE=1 -e PYTHONPATH=/app \
  -e ELASTICSEARCH_URL=http://host.docker.internal:9200 -e OMP_NUM_THREADS=4 -e MKL_NUM_THREADS=4 \
  test-api:latest python - <<'PY'
from pathlib import Path
import yaml
from fastapi import FastAPI
from shopmind.app.core.config import load_app_config
from shopmind.app.main import _wire_runtime
from evaluation.datasets import load_queries, load_qrels
from evaluation.runner import run_experiment
cfg = load_app_config("configs/app.yaml")
cfg.elasticsearch.index_alias = "products_accuracy_20261009_v2"
cfg.rag.enabled = False
app = FastAPI(); _wire_runtime(app, cfg)
service = app.state.search_service
service.embedding_model = app.state.embedder.model_name
service.embedding_version = app.state.embedder.model_revision
queries = load_queries("evaluation/benchmarks/accuracy_v2/queries.jsonl")
qrels = load_qrels("evaluation/benchmarks/accuracy_v2/qrels.jsonl", queries)
split = "holdout" # use dev to reproduce development only
path = Path("/tmp/accuracy_reproduction.yaml")
path.write_text(yaml.safe_dump({"experiment": {"name": "accuracy_reproduction_"+split, "dataset_version": "accuracy_v2", "index_version": cfg.elasticsearch.index_alias}, "retrieval": {"mode": "hybrid", "top_k": 10, "candidate_k": 100}, "fusion": {"method": "rrf", "rrf_k": 60}}))
print(run_experiment(path, service, [q for q in queries if q.split == split], qrels, "runs/accuracy_reproduction").run_dir)
PY
```

Reproduce the real diagnostic with that same Docker mounting/environment and `python -m scripts.diagnose_embedding_accuracy --output runs/accuracy_reproduction/batch_diagnostic.json`.

Baseline reproduction requires an isolated code checkout/archive of source commit `798b5d9` (which includes the frozen evaluation contract), the unchanged corpus/HF cache and physical `products_a1_1500_v1`. Use the same tracked-module snippet with that checkout’s original `configs/app.yaml`, index set to `products_a1_1500_v1`, and modes `bm25`, `hybrid`, `dense` for each split. Its provider retains original dynamic padding and unspecified revision; cached query model commit is known, but legacy index vector generation revision is **unknown**, and must not be fabricated. The old artifact manifests load for baseline/archive use; corrected runtime rejects their unknown identity.

## Activation, rollback and limitations

Alias `products` still targets `products_a1_1500_v1`; activate only after independent review PASS. Atomic alias switch command is the existing `switch_alias(client, alias="products", target="products_accuracy_20261009_v2")`. The old index and old artifacts remain available. Restart the API after switching so runtime validates and pins the new concrete target. Existing running repositories intentionally continue querying their validated physical target through alias changes.

Rollback requires deploying the previous backend/runtime configuration (source `798b5d9`) and switching `products` to `products_a1_1500_v1`, then restarting. Switching only the alias while keeping corrected runtime would correctly fail closed on legacy unknown identity.

The selected lexical-preserving hybrid retains dense computation: candidate holdout latency p50 **667.96 ms**, p95 **1701.00 ms**, versus old BM25 p50 **21.81 ms**, p95 **78.97 ms** in this local CPU environment. DEV BM25 tied its quality; no hybrid latency or semantic superiority is claimed. Finite static vocabulary leaves unsupported language/category/color expressions unchanged. The small holdout is metadata grounded and establishes only this benchmark’s improvement.

Skipped: real LLM/review answer measurements and human visual/semantic relevance review; they remain null. Risk: API startup requires verified candidate identity, and alias activation/restart remains pending independent review.


## Review round 1 corrections — 2026-10-10

Base: `a89afb8d51c9b03322e27d5ab8666966b29a9e43`. Both Important findings in `task-2-review.md` are addressed without changing retrieval configuration, vocabulary, frozen queries/qrels, vector artifacts or index targets.

1. **Validate the text preprocessing used by cross-modal queries (P2).** `CrossModalRetriever` now validates text identity first, which pins the physical target, then image identity on that same physical index before encoding or kNN. Regression cases reject wrong text or image preprocessing before either provider/vector call; the valid case moves the fake alias between checks and verifies both validation and vector search remain on the pinned target.
2. **Skip dense when lexical results already determine the whole NoOp output (P2).** With `lexical_preserving=true`, the actual `NoOpReranker` type, and at least `top_k` lexical hits, hybrid returns the lexical results directly. Exact-ID priority/filters still run first. Scores and BM25 ranks are genuine lexical values; dense rank, RRF score/contributions and reranker score are null, while ordering policy remains `lexical_preserving`. Debug output exposes the genuine BM25 score. Insufficient lexical results, custom rerankers and subclasses with custom behavior keep the existing full dense/fusion path.

Verification commands (host `/Users/yuji/anaconda3/bin/python`, with the same live Elasticsearch candidate index):

```sh
python -m pytest -q tests/unit/test_dense_retriever.py tests/unit/test_hybrid_retriever.py
python -m pytest -q tests/unit/test_dense_retriever.py tests/unit/test_hybrid_retriever.py tests/unit/test_embedding_contract.py tests/unit/test_embedding_artifacts.py tests/api tests/integration
python runs/accuracy/review_round1_dev_check.py
python -m ruff check shopmind/app/retrieval/dense.py shopmind/app/retrieval/hybrid.py shopmind/app/api/schemas/search.py tests/unit/test_dense_retriever.py tests/unit/test_hybrid_retriever.py
git diff --check
```

Red evidence: `runs/accuracy/review_round1_red.log` has exactly the two reproduced failures before correction. Focused verification: **58 passed**, including live Elasticsearch integration (`review_round1_tests.log`); correctness lint/whitespace checks pass (`review_round1_lint.log`). Regression coverage includes failed dense being skipped, honest lexical debug fields, insufficient lexical candidates, ordinary custom rerankers and a NoOp subclass with custom behavior.

Live DEV comparison: **130/130 queries preserved recorded winner IDs and ranks**, with **zero dense calls** while dense was deliberately unavailable. Reference: `runs/accuracy/20261009T163848Z_candidate_dev_lexical/results.jsonl`, SHA256 `ee098f121fb287a9a3a08f19f9bd34d18fee4e05b6fa75c61101b85fb1c4eb98`. Full current debug rows are in `runs/accuracy/review_round1_dev_check.json`; stdout is in `review_round1_dev_check.log`. This check uses the actual lexical repository/index and only the development split. No holdout measurement or quality selection was repeated; the earlier frozen holdout result stays historical evidence. Numeric scores change to lexical scores on the skipped path, while IDs/order remain unchanged.

Round 1 code/evidence hashes and unchanged input checks: `runs/accuracy/review_round1_provenance.json`. Original `final_measurements.json` source hashes describe the original measured commit `a89afb8`, not this revision. Old/candidate vector and frozen config/vocabulary/benchmark hashes were checked unchanged. Alias `products` still targets `products_a1_1500_v1` pending scoped independent re-review.

No new timing experiment was required: avoiding dense calls is directly verified, and the earlier local CPU latency values are historical measurements, not a controlled short-circuit speedup claim. Real LLM/review semantic measurements remain **null**.

Skipped: model regeneration, holdout rerun and new latency benchmark. Risk: activation/restart remains pending independent re-review; the static vocabulary and narrow metadata benchmark retain their documented limits.
