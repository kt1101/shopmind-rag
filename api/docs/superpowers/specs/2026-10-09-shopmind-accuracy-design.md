# ShopMind accuracy improvement design

**Date:** 2026-10-09. **Execution:** subagents implement and review; the parent agent manages assignments, dependencies, gates, and reporting.

## Goal and current evidence

Improve the actual text/image retrieval and product-question flow, with reproducible before/after measurements on the same catalog. Backend work uses `codex/accuracy-improvement`, created from `codex/assignment-a3` at `923ddb12ab435d86ed24a78889116019c862556d`; UI work starts from `codex/assignment-a3-ui` on a new `codex/accuracy-improvement-ui` branch. Use the current checkout to reuse ignored corpus/model assets. Preserve the user's untracked `reports/a1/slides/` artifacts.

The catalog contains 1,500 products and existing SigLIP2 text/image artifacts. Historical seed-label measurements report BM25 Recall@10 0.4625, equal-weight hybrid RRF 0.3250, dense text 0.0125, and transformed catalog-image identity retrieval 1.0. These are diagnostic results, not independently reviewed semantic relevance. Five repeated text-query groups have contradictory single-target labels. No real review corpus, measured A3 answer benchmark, or previous `reports/a3/QUALITY_REVIEW.md` exists in this checkout. Initial inspection found Elasticsearch/API unavailable and no `sentence_transformers` installation; these are current environment conditions to resolve or report.

Sources: `reports/a1/RESULTS.md`, `reports/a1/SEARCH_REVIEW.md`, `evaluation/benchmarks/a1/{queries,qrels}.jsonl`, `data/a1_abo_1500/products.jsonl`, and `data/embeddings/abo_a1_1500_v1/manifest.json`. Shared metric inspection reproduced nDCG 1.6309297535714575 for ranking `[p1,p1]` with one relevant `p1`; both runners currently exclude failed requests from quality averages.

## Measurement contract

- Create `evaluation/benchmarks/accuracy_v2/` without changing A1 labels. Use documented, fixed English/Vietnamese category/color aliases and exact catalog brand strings. Every predicate question receives all matching catalog products as positives; an unknown relevance judgment is never invented. Label status is `metadata_grounded`, not human reviewed.
- Partition supported categories deterministically with seed 42 into 70% development and 30% holdout categories, before selecting queries. All English/Vietnamese variants and product IDs for a category remain in its split. Exact-ID probes use products in that split. This keeps positive products and query intents disjoint across splits.
- Generate up to 60 unique nonempty category/brand/color predicate groups, balanced across `category_brand`, `category_color`, and `category_brand_color`, with at most 20 positives per predicate; add 40 exact-ID probes. Keep distinct query strings and complete positive qrels. Write manifest corpus/query/qrel SHA256 hashes, split rule, alias map, seed, positive counts, and label limitations. Freeze the files before retrieval tuning.
- Report Recall@10, nDCG@10, MRR@10 by language/group/split. Broad queries can have more than ten valid results, so nDCG@10 is primary and raw Recall@10's `min(10,N)/N` ceiling is reported. Exact-ID probes additionally report top-1 hit rate.
- Duplicate results consume their original rank and contribute no repeated gain. Primary quality metrics include failed attempts as zero; separately retain successful-request means and success rate. Missing semantic answer judgments remain null.
- Baseline runs use the old artifacts/index and current code before switching aliases. Select retrieval configuration on development only, record it, and run that choice once on holdout. Compare baseline/candidate per query on the frozen data. Preserve source run artifacts and a tracked compact report.

## Changes and interfaces

Retain `/api/v1/search/text`, `/api/v1/search/image`, `/api/v1/rag/ask`, and their public response shape. Add only optional diagnostic metadata. Reuse Elasticsearch, SigLIP2, existing runners and pytest; add no mandatory dependency or model merely because it is newer.

1. Correct the shared retrieval metric and runner accounting, add strict benchmark provenance and source/semantic failure taxonomy. RAG tests distinguish ID validity, source presence, fact-string proxies, and actual semantic correctness.
2. Run actual CPU/model batch-invariance probes, comparing each text alone and with longer companions. If dynamic padding changes vectors, use fixed maximum-length padding for both indexing and querying. Pin the actual cached model commit, encode preprocessing identity in artifact/index metadata, regenerate into a new artifact directory/index, and reject incompatible vectors. Ensure exact IDs stay top-1 through hybrid and review/product filters remain exact.
3. Put review rating/verified/time/product linkage and policy provenance in evidence, preserve useful excerpts within the configured character limit, and mark truncation. Reject empty answers, retry invalid structured output/citations at most twice total, and emit controlled errors after exhaustion. Instructions match the user's language, disclose conflicting reviews and evidence gaps, and label experimental policies. UI labels retrieval scores as relevance rather than confidence, shows source limitations, and prevents responses for a previous selected product from appearing under a new product.
4. Run integrated before/after checks and an independent review. Preserve old artifact/index; switch the product alias only after compatibility, counts, exact-ID, and integration gates pass. If the model/key/review corpus cannot support a real measurement, report that measurement as unavailable with the concrete reason.

## Acceptance

- Actual real-model text batch cosine similarity is at least 0.99999 across the fixed probe set after the fix; nonfinite, zero, dimension/model/preprocessing-incompatible knowledge vectors are rejected.
- Exact product ID top-1 is 100% across 40 frozen probes in BM25/hybrid. Fixed-choice holdout nDCG@10 targets an improvement of at least 0.05 absolute, with no holdout MRR/Recall decrease; report a missed target honestly and retain the best development-qualified configuration. Do not retune after seeing holdout.
- Existing 20 image identity probes do not regress. Their labels remain identity labels; no independent visual relevance claim follows.
- No blank answer, wrong-product citation, unknown citation, malformed output leak, or unmarked experimental policy in deterministic adversarial fixtures. API tests check controlled failures and repair bounds. Synthetic fixtures demonstrate behavior, not real LLM answer accuracy.
- Backend/frontend checks pass and actual integration checks run against Elasticsearch. Human/real-model semantic answer accuracy remains unmeasured until a configured model and suitable evidence/labels exist; unit-test counts are reported separately from quality.

## Ownership and gates

Evaluation agent owns `evaluation/`, benchmark/build/run scripts, its evaluation tests and `reports/accuracy/`. Retrieval agent owns embedding/provider/artifact/index/retrieval code, related tests/configs and its diagnostic script. Evidence agent owns RAG/LLM/context/knowledge retrieval and frontend behavior/tests. Shared config files have one assigned writer at a time. An independent reviewer examines each completed task before the next dependent task begins; the manager assigns revisions to the original owner and does not implement product code.
