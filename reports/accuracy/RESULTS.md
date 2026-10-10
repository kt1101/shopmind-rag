# ShopMind accuracy acceptance

**Integrated acceptance PASS.** Task 1–3 stage review gates are closed; a final whole-branch review follows this report commit.

Metadata-grounded holdout nDCG@10 improved from **0.370035** (old deployed hybrid) to **0.607537**; improvement **+0.237503**. Against strongest old BM25, improvement is **+0.082028**. Both exceed the frozen +0.05 target. Real LLM answer accuracy and real review answer accuracy remain **null**.

Backend `codex/accuracy-improvement`, current `1aa8f6768f129f9b6b4f2373d31707b3e7eb18a2`; UI `codex/accuracy-improvement-ui`, `c9fbfb21fac90bc42424f52c5725b63035663599`. Measured rankings belong to `a89afb8`; the later `7dbcccc` correction preserved 130/130 DEV IDs/order with zero dense calls. Task 3 changes affect answer context/validation/UI, not the frozen retrieval selection.

## Scope and measurement

Frozen corpus: 1,500 products, 215 categories. Benchmark supports 43 categories/812 products and labels 135 distinct positive products, with 160 queries/278 qrels. DEV: 130 rows (102 natural-language rows, 51 bilingual intents, 28 exact IDs), 30 categories. Holdout: 30 rows (18 natural-language rows, 9 bilingual intents, 12 exact IDs), 13 disjoint categories and 22 positive products. Labels are exact metadata predicates with complete positives, not human semantic relevance. Shared-image cross-category exclusions prevent documented leakage; product-family leakage has not been human audited.

Selection was frozen on DEV at `2026-10-09T16:40:31.055368+00:00`: public hybrid mode, lexical_preserving=true, top_k=10, candidate_k=100, RRF k=60. BM25 and lexical-preserving hybrid tied. The equal-RRF DEV ablation named `candidate_dev_hybrid` below was weaker; it is not the selected runtime policy. Candidate holdout ran once. No holdout tuning or rerun followed. All recorded query attempts succeeded; failures would enter primary denominators as zero.

All table cells are **nDCG@10 / Recall@10 / MRR@10**. Exact IDs are reported separately from natural language.

| Split/mode | Overall | Natural language only | Exact ID top1 | Success |
|---|---|---|---|---|
| baseline_dev_hybrid | 0.258555 / 0.306410 / 0.260211 | 0.080349 / 0.116013 / 0.091445 | 0/28 | 130/130 |
| baseline_dev_bm25 | 0.416507 / 0.508462 / 0.402250 | 0.256332 / 0.373529 / 0.238161 | 0/28 | 130/130 |
| baseline_dev_dense | 0.007118 / 0.007692 / 0.011538 | 0.009072 / 0.009804 / 0.014706 | 0/28 | 130/130 |
| candidate_dev_hybrid | 0.361680 / 0.488520 / 0.365601 | 0.186455 / 0.348113 / 0.191453 | 0/28 | 130/130 |
| candidate_dev_dense | 0.012602 / 0.013333 / 0.024432 | 0.016062 / 0.016993 / 0.031139 | 0/28 | 130/130 |
| candidate_dev_bm25 | 0.663563 / 0.772448 / 0.637277 | 0.571207 / 0.709982 / 0.537706 | 0/28 | 130/130 |
| candidate_dev_lexical | 0.663563 / 0.772448 / 0.637277 | 0.571207 / 0.709982 / 0.537706 | 0/28 | 130/130 |
| baseline_holdout_hybrid | 0.370035 / 0.466667 / 0.337500 | 0.073081 / 0.111111 / 0.062500 | 0/12 | 30/30 |
| baseline_holdout_bm25 | 0.525510 / 0.600000 / 0.502910 | 0.209183 / 0.333333 / 0.171517 | 0/12 | 30/30 |
| baseline_holdout_dense | 0.000000 / 0.000000 / 0.000000 | 0.000000 / 0.000000 / 0.000000 | 0/12 | 30/30 |
| candidate_holdout_winner | 0.607537 / 0.666667 / 0.588095 | 0.345896 / 0.444444 / 0.313492 | 0/12 | 30/30 |

| Holdout subset | Old hybrid | Old BM25 | Frozen candidate | Δ hybrid | Δ BM25 |
|---|---|---|---|---|---|
| en (9 rows) | 0.035052 / 0.111111 / 0.013889 | 0.270218 / 0.444444 / 0.216049 | 0.362429 / 0.444444 / 0.333333 | 0.327377 / 0.333333 / 0.319444 | 0.092211 / 0.000000 / 0.117284 |
| vi (9 rows) | 0.111111 / 0.111111 / 0.111111 | 0.148148 / 0.222222 / 0.126984 | 0.329363 / 0.444444 / 0.293651 | 0.218251 / 0.333333 / 0.182540 | 0.181214 / 0.222222 / 0.166667 |

| Split/group | Old hybrid | Old BM25 | Selected candidate | Δ hybrid | Δ BM25 |
|---|---|---|---|---|---|
| dev/category_brand | 0.090289 / 0.098039 / 0.136555 | 0.216176 / 0.382353 / 0.185854 | 0.696060 / 0.829947 / 0.666246 | 0.605770 / 0.731907 / 0.529692 | 0.479884 / 0.447594 / 0.480392 |
| dev/category_brand_color | 0.119295 / 0.210938 / 0.094308 | 0.489944 / 0.656250 / 0.465315 | 0.718112 / 0.812500 / 0.714583 | 0.598817 / 0.601562 / 0.620275 | 0.228168 / 0.156250 / 0.249268 |
| dev/category_color | 0.036343 / 0.048611 / 0.046296 | 0.086603 / 0.113889 / 0.085648 | 0.322709 / 0.505556 / 0.259083 | 0.286366 / 0.456944 / 0.212787 | 0.236105 / 0.391667 / 0.173435 |
| dev/exact_id | 0.907732 / 1.000000 / 0.875000 | 1.000000 / 1.000000 / 1.000000 | 1.000000 / 1.000000 / 1.000000 | 0.092268 / 0.000000 / 0.125000 | 0.000000 / 0.000000 / 0.000000 |
| holdout/category_brand | 0.000000 / 0.000000 / 0.000000 | 0.000000 / 0.000000 / 0.000000 | 0.000000 / 0.000000 / 0.000000 | 0.000000 / 0.000000 / 0.000000 | 0.000000 / 0.000000 / 0.000000 |
| holdout/category_brand_color | 0.164433 / 0.250000 / 0.140625 | 0.433033 / 0.625000 / 0.372024 | 0.620533 / 0.750000 / 0.580357 | 0.456100 / 0.500000 / 0.439732 | 0.187500 / 0.125000 / 0.208333 |
| holdout/category_color | 0.000000 / 0.000000 / 0.000000 | 0.075257 / 0.250000 / 0.027778 | 0.315465 / 0.500000 / 0.250000 | 0.315465 / 0.500000 / 0.250000 | 0.240207 / 0.250000 / 0.222222 |
| holdout/exact_id | 0.815465 / 1.000000 / 0.750000 | 1.000000 / 1.000000 / 1.000000 | 1.000000 / 1.000000 / 1.000000 | 0.184535 / 0.000000 / 0.250000 | 0.000000 / 0.000000 / 0.000000 |

| DEV natural-language subset | Old hybrid | Old BM25 | Selected lexical hybrid | Δ hybrid | Δ BM25 |
|---|---|---|---|---|---|
| en (51 rows) | 0.048646 / 0.061765 / 0.077614 | 0.324586 / 0.432680 / 0.325731 | 0.567415 / 0.705080 / 0.537706 | 0.518769 / 0.643316 / 0.460092 | 0.242828 / 0.272400 / 0.211975 |
| vi (51 rows) | 0.112053 / 0.170261 / 0.105275 | 0.188078 / 0.314379 / 0.150591 | 0.575000 / 0.714884 / 0.537706 | 0.462947 / 0.544623 / 0.432431 | 0.386921 / 0.400505 / 0.387115 |

## Representative raw results

| Frozen query | Old BM25 nDCG | Candidate nDCG | Result |
|---|---:|---:|---|
| `predicate_057_vi`: Tìm chai màu hồng của Amazon Brand - Solimo. | 0.000000 | 1.000000 | Improved |
| `predicate_022_vi`: Tìm ba lô màu xanh lá. | 0.000000 | 0.630930 | Improved |
| `predicate_060_en`: Find backpacks in yellow from AmazonBasics. | 0.630930 | 1.000000 | Improved |
| `predicate_014_en`: Find planters from AmazonBasics. | 0.000000 | 0.000000 | Still no relevant top10 |
| `predicate_031_vi`: Tìm mũ màu đỏ. | 0.000000 | 0.000000 | Still no relevant top10 |
| `predicate_044_vi`: Tìm ba lô màu xám của AmazonBasics. | 0.000000 | 0.000000 | Still no relevant top10 |

Remaining corrected dense DEV nDCG = 0.012602. Fixed padding solves batch inconsistency, but this model still has weak semantic retrieval on these metadata labels. Static lexical translation leaves unsupported expressions unchanged. Natural-language candidate holdout Recall=0.444444 versus overall0.666667; exact IDs materially lift the overall result.

## Embedding, image and runtime evidence

- Actual six-probe CPU batch diagnostic: dynamic padding minimum cosine 0.54245919; fixed 64-token padding minimum 0.9999997616 and maximum L2 difference 0.0. Pinned model `google/siglip2-base-patch16-224`, cached revision `75de2d55ec2d0b4efc50b3e9ad70dba96a7b2fa2`, 768 normalized dimensions. Both regenerated 1,500-row matrices are finite/nonzero; mapping/artifact identities are validated before inference. Legacy index generation revision remains unknown.
- Image identity retrieval: old 20/20 and candidate 20/20, nDCG/Recall/MRR all 1.0. These are identical source-image probes; independent cross-view/image relevance is unmeasured.
- Docker CPU cached image `test-api:latest` digest `sha256:60b2f93d954b856774f946b6b1daa1b6a2d022ba454e68a9a1dd999d1f2111c0`; torch2.14.0+cu130, transformers4.57.6, numpy2.5.3, Elasticsearch server 8.15.3/client 8.19.3, CUDA unavailable; 4 CPU threads.
- Historical local holdout timing before dense short-circuit: candidate p50/p95 667.96/1701.00ms, old BM25 21.81/78.97ms. Runs were uncontrolled; no specific latency speedup or hybrid advantage is claimed. Current DEV check directly proves zero dense calls and unchanged IDs/order.

## Integration and browser acceptance

- Initial Task4 full backend: 198 passed/1 opt-in slow model skip. After source-fairness correction at1aa8f67: owner full200 passed/1 skip; independent Task4 covering32 passed. Existing Starlette httpx deprecation is retained. Live Elasticsearch integration4 passed. UI 12 passed, build 18 modules; both whitespace checks pass. Test counts establish structural behavior, not answer accuracy.
- Real browser `127.0.0.1:5174` → actual API `127.0.0.1:8000`: readiness, shoes query,10 actual catalog results in BM25/hybrid, selected product A, product/review/policy source choices, configured-key error, then B selection clears question/error.
- Explicit simulation `127.0.0.1:5175` → separate QA proxy8001: actual catalog retrieval plus Task 3 real Elasticsearch/RAG scripted generation fixture, with clearly SCRIPTED display fields for excerpt/unavailable review/experimental policy. Verified IDs, relevance wording, excerpt warning, missing-source warning, experimental disclaimer/link, two question turns, A→B clearing and delayed obsolete-answer suppression. Captured request bodies include selected ID/sources/debug, no history. Actual API8000 remains unchanged and unavailable without its key.
- Evidence: `runs/accuracy/task4/browser-actual-503.{txt,png}`, `browser-scripted-answer.{txt,png}`, `browser-scripted-selection-b.txt`, `browser-scripted-cancelled.txt`, `scripted-browser-requests.jsonl`, `scripted-server.log`. The QA fixture checks presentation only; policy data and answer wording are synthetic. It loaded backend fixture source9e0907c before the fairness correction; the unchanged UI is c9fbfb2 and current backend fairness is covered separately by32 tests and independent re-review.

## Provenance and reproduction

Task4 independently validated 78 raw artifact hashes, 35 measured source hashes **against measured commit a89afb8**, all frozen inputs, qrel completeness over the entire corpus, category partition and every exported ranking metric. Current source hashes are recorded separately. `comparison.json` preserves per-run IDs/metrics, overall/NL/group/language/exact denominators, examples and raw/config/source/artifact/snapshot hashes. Full ignored raw exports remain under `runs/accuracy/`; they are required to reproduce this historical result and were not rewritten.

| Frozen input | SHA256 |
|---|---|
| `evaluation/benchmarks/accuracy_v2/queries.jsonl` | `a9ad335e7ca8c830322f58de74d8733bc937853fadd154592554edb188362844` |
| `evaluation/benchmarks/accuracy_v2/qrels.jsonl` | `d2fa9c41bccfe35969b8cb0d67048d0a92c0d6640db5bd55e80d8df388b11d99` |
| `evaluation/benchmarks/accuracy_v2/manifest.json` | `09326307ab61dbb882f182777e5b5aa26b14da2a6d6807ccf1e1029df259c5b7` |
| `data/a1_abo_1500/products.jsonl` | `addc2b80493d9bda334af1130aabab401f4287806324f56b55c8a7cfc87472e4` |

Current verification commands (repository roots):

```sh
/Users/yuji/anaconda3/bin/python -m pytest -q -rs
/Users/yuji/anaconda3/bin/python -m pytest -q tests/integration -rs
/Users/yuji/anaconda3/bin/python -m pytest -q tests/a3/test_a3_service.py tests/api/test_rag_api.py tests/a3/test_a3_quality.py
PYTHONPATH=. /Users/yuji/anaconda3/bin/python runs/accuracy/task4/audit.py
PYTHONPATH=. /Users/yuji/anaconda3/bin/python .superpowers/sdd/2026-10-09-shopmind-accuracy/task-3-evidence/task3-real-es-api.py
git diff --check
cd /Users/yuji/research/rag/test-ui
npm test
npm run build
git diff --check
```

Tracked-module Docker reproduction and original baseline checkout steps are fully specified in `.superpowers/sdd/2026-10-09-shopmind-accuracy/task-2-report.md`. Use old source 798b5d9 with physical old index for baseline; corrected source with candidate index for reproduction. Do not overwrite frozen results or selection. Batch diagnostic: `python -m scripts.diagnose_embedding_accuracy --output runs/accuracy_reproduction/batch_diagnostic.json` in the documented offline Docker CPU environment. Historical launchers: `runs/accuracy/measure.py`, `holdout_and_smoke.py`; no benchmark request was attempted by the earlier failed TestClient launcher.

## Activation, rollback and next evidence

Active `products` → `products_accuracy_20261009_v2`, 1,500 documents; preserved `products_a1_1500_v1`, 1,500 documents. Runtime pins a validated physical target. Task-owned container `shopmind-accuracy-api` binds 127.0.0.1:8000, uvicorn PID 1 with mounted checkout and no auto-reload. After Task 3 scoped re-review passed, the owner restarted the container on current source `1aa8f67`. Task 4 verified `/ready` 200, lowercase exact-ID hybrid top1, natural-language 10 results and all-source RAG `503 llm_unavailable`; see `runs/accuracy/task4/final-api-smoke.{json,log}`. Restart after later edits via `docker restart shopmind-accuracy-api` and verify readiness/current-source smoke.

Rollback: deploy previous backend/config798b5d9, atomically use existing `switch_alias(client, alias="products", target="products_a1_1500_v1")`, then restart that previous runtime. Alias-only rollback with corrected runtime fails closed on legacy unknown identity; existing repositories remain pinned until restart. Both old artifacts/index remain available.

Next required evidence: configure a real LLM key, acquire real product-linked reviews and human answer/relevance labels, and measure held-out semantic/language/conflict/partial-insufficiency behavior and independent image views. Real answer/review semantic measurements remain null.

Skipped: further holdout/model regeneration, uncontrolled timing runs and real semantic model judgment. Risk: the30 row metadata holdout and identity probes support only their stated scope.
