# ShopMind A1 retrieval results

Run date: 2026-10-17. Dataset: `abo_a1_1500_v1` (1,500 ABO products, 215 categories, max 150/category;
corpus sha256 `addc2b80…72e4`, identical to the frozen accuracy benchmark corpus). Index:
`products_a1_1500_v2` — `text_vector` = `intfloat/multilingual-e5-base` (768-d, `query:`/`passage:`
prefixes, product text from the configured `document_template`), `image_vector` and
`siglip_text_vector` = `google/siglip2-base-patch16-224` (768-d). All runs on CPU, profile `eval`.

Every number below is copied from a `metrics.json` in the local, git-ignored `runs/` directory:

| Benchmark | Run directory |
|---|---|
| A1 text ablation (80 queries) | `runs/a1/ablation_20261017T041418Z/` + `runs/a1/20261017T0412*`–`T0414*` |
| A1 image (20 queries) | `runs/a1/20261017T042425Z_image_dense/` |
| accuracy_v2 (160 queries, DEV/holdout) | `runs/accuracy_v2/ablation_20261017T042255Z/` + per-run dirs |
| F1 composed retrieval (40 queries) | `runs/compose/20261017T043004Z_compose_f1/` |

**Labels.** The A1 qrels are deterministic seed labels (seed 42) and the accuracy_v2 qrels are
metadata predicates; neither has been human-reviewed yet (the admin Annotation page + Cohen's kappa
exist for that). The F1 labels are synthetic (same category + target colour). Treat all deltas as
indicative, not statistically tested.

## A-6: controlled text ablation, A1 benchmark (80 text queries)

| Run (pipeline) | Recall@10 | nDCG@10 | MRR@10 | Recall vi | Recall en | Recall semantic | p50 ms | p95 ms |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| BM25 (`search.bm25`) | 0.4875 | 0.3632 | 0.3265 | 0.2571 | 0.6667 | 0.4571 | 45.7 | 63.6 |
| Dense E5 (`search.dense`) | **0.5500** | 0.4424 | 0.4091 | 0.2571 | 0.7778 | 0.4857 | 89.3 | 115.2 |
| Dense SigLIP2 text, previous (`search.dense_siglip`) | 0.0375 | 0.0375 | 0.0375 | 0.0000 | 0.0667 | 0.0000 | 198.2 | 275.5 |
| Cross-modal text → image | 0.2125 | 0.1229 | 0.0963 | 0.0000 | 0.3778 | 0.3143 | 180.2 | 309.4 |
| BM25 + dense, no fusion (control) | 0.5000 | 0.3711 | 0.3327 | 0.2571 | 0.6889 | 0.4571 | 186.8 | 254.1 |
| Hybrid RRF, equal weights (`search.hybrid`) | 0.5000 | 0.4051 | 0.3739 | 0.2857 | 0.6667 | 0.4286 | 169.0 | 225.9 |
| Hybrid RRF, weights 1.0 / 0.5 | 0.5125 | 0.4037 | 0.3697 | 0.2857 | 0.6889 | 0.4857 | 177.8 | 231.2 |
| **Hybrid linear min-max (`search.hybrid_linear`, default)** | **0.5875** | 0.4470 | 0.4027 | **0.3143** | **0.8000** | **0.5714** | 167.7 | 293.9 |
| Hybrid lexical-preserving (previous production) | 0.5000 | 0.3711 | 0.3327 | 0.2571 | 0.6889 | 0.4571 | 171.7 | 298.8 |
| Adaptive rule router (`search.adaptive`) | 0.5625 | **0.4517** | **0.4171** | 0.2857 | 0.7778 | 0.5429 | 115.8 | 230.1 |

**A-5 (cross-encoder rerank, `search.hybrid_rerank`) is implemented but has no measured row.** With
`BAAI/bge-reranker-v2-m3` reranking the top 50 on this laptop CPU, the 80-query run was stopped after
more than 2 h 15 min of CPU time without finishing (> 100 s per query), so no metrics.json exists. It needs
a GPU, a smaller depth or a smaller model (for example `BAAI/bge-reranker-base`) before it can be measured
or used interactively; it stays opt-in.

Previous report (2026-09-17, SigLIP2 for text): BM25 Recall@10 0.4625, dense 0.0125, hybrid RRF 0.3250.

Acceptance (plan §4): dense text Recall@10 on semantic queries 0.4857 > BM25 0.4571, and every hybrid
is ≥ BM25 overall (RRF 0.5000, linear 0.5875 vs 0.4875) — **met**. The dedicated text embedder (A-1)
is the cause: the same pipeline with SigLIP2 text vectors reaches 0.0375. Vietnamese queries remain the
weak spot (best Recall@10 0.3143).

## Selection on DEV, report on holdout (accuracy_v2, 160 queries)

The default `mode=hybrid` pipeline was chosen on the DEV split (130 queries) and then read once on the
holdout split (30 queries, disjoint categories). No holdout tuning.

| Run | DEV nDCG@10 | DEV Recall@10 | Holdout nDCG@10 | Holdout Recall@10 | Holdout MRR@10 | Exact-ID top1 (dev / holdout) |
|---|---:|---:|---:|---:|---:|---|
| BM25 | 0.6636 | 0.7724 | 0.6075 | 0.6667 | 0.5881 | 1.0 / 1.0 |
| Dense E5 | 0.4298 | 0.5156 | 0.3151 | 0.3500 | 0.3153 | 0.0 / 0.0 |
| Hybrid RRF | 0.7312 | 0.8329 | 0.6720 | 0.7667 | 0.6428 | 1.0 / 1.0 |
| Hybrid RRF 1.0 / 0.5 | 0.7387 | 0.8565 | 0.6548 | 0.7333 | 0.6311 | 1.0 / 1.0 |
| **Hybrid linear (selected: best DEV nDCG)** | **0.7773** | 0.8510 | **0.6961** | **0.8000** | 0.6673 | 1.0 / 1.0 |
| Lexical-preserving (previous production) | 0.6636 | 0.7724 | 0.6075 | 0.6667 | 0.5881 | 1.0 / 1.0 |
| Adaptive | 0.6481 | 0.7323 | 0.7151 | 0.7500 | 0.7153 | 1.0 / 1.0 |

Holdout nDCG@10 of the selected pipeline improves on the previously frozen winner (lexical-preserving,
0.6075) by **+0.0886**. Adaptive scores higher on holdout but lower on DEV; it was not selected because
choosing it would use the holdout for selection.

## Vocabulary extension (2026-10-17, after the selection above)

General Vietnamese shopping vocabulary was added (`configs/vocab/`: common product nouns, materials as
lexical-only `term_aliases`, colours brown/yellow/purple/orange/silver/gold); it was written from the
catalog's categories, not from benchmark queries. DEV results are unchanged for every run
(`runs/accuracy_v2_vocab/`), so the pipeline selection stands. Holdout, read again after this general
change (it had been read once before):

| Run | Holdout nDCG@10 before | after | Vietnamese nDCG@10 before | after |
|---|---:|---:|---:|---:|
| BM25 | 0.6075 | 0.6631 | 0.5382 | 0.5659 |
| Hybrid linear (default) | 0.6961 | **0.7381** | 0.6073 | 0.6283 |

The A1 seed benchmark is unchanged (`runs/a1_vocab/`): its Vietnamese queries are templated brand
queries ("tìm AmazonBasics sản phẩm…") that the new nouns do not touch.

## Serving latency (2026-10-17)

Median of repeated requests against the local API (laptop CPU, ES on the same machine), before → after
the runtime optimizations (query-embedding LRU cache, image-embedding cache keyed by pixels, cached
catalog-filter resolution and index mapping, concurrent retrieve steps, lighter `_source` for hits):

| Request | Before | After |
|---|---:|---:|
| Text search, new query (E5 encoding needed) | 179 ms | 179 ms |
| Text search, repeated query / inspector re-run | 136 ms | 64 ms |
| Text search with brand + category filters | 70 ms | 16 ms |
| Compose search while moving the α slider | 334 ms | 68 ms |
| Shopping planner (6 needs) | 614 ms | 213 ms |

## Image search (20 transformed image queries)

Image kNN on `image_vector`: Recall@10 1.0000, nDCG@10 1.0000, MRR@10 1.0000 (p50 1221 ms, p95 2071 ms
on a shared laptop CPU including SigLIP2 image encoding). Queries are crop/resize/contrast/JPEG
transformations; no query file is byte-identical to its catalog image.

## F1: composed image + text retrieval (40 queries)

Query = image of product A + the colour of product B (same category, different colour) as text,
alternating Vietnamese ("màu đen") and English ("black"). Relevant: B (grade 2) and other products of
that category and colour (grade 1).

| Mode | Recall@10 | nDCG@10 | MRR@10 | Target B in top 10 |
|---|---:|---:|---:|---:|
| Image only | 0.1996 | 0.1065 | 0.1089 | 0.2000 |
| Text only (colour) | 0.2328 | 0.1484 | 0.2173 | 0.1750 |
| Text: colour + category words | 0.4869 | 0.4039 | 0.5508 | 0.4250 |
| Composed α = 0.7 | 0.5320 | 0.3762 | 0.3617 | 0.5750 |
| Composed α = 0.5 | 0.6077 | 0.4390 | 0.4582 | 0.6250 |
| **Composed α = 0.3** | **0.7207** | **0.5360** | **0.6288** | **0.7000** |

Every composed setting beats both single modalities and the text query that names the category.
α was compared on this same synthetic set (no separate tuning split), so the runtime default
`features.compose_default_alpha` is set to 0.5 rather than the best value; the Lab and the search page
expose α as a slider.

## Error analysis

`runs/a1/ablation_20261017T041418Z/error-cases.jsonl` lists the 20 lowest-nDCG queries of the preferred
run with their relevant and retrieved IDs. Remaining failure types: Vietnamese descriptive queries with
no alias in `configs/vocab/` (the E5 model handles them better than BM25 but still misses), multi-lingual
product titles (Dutch/Italian/Spanish ABO listings), and near-duplicate variants that share an image.

## Data note

ABO's official download page states CC BY 4.0 while the AWS Registry states CC BY-NC 4.0. This coursework
applies the conservative CC BY-NC 4.0 interpretation and attributes Amazon.com and the ABO authors.
