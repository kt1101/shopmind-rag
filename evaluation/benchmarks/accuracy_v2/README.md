# Frozen accuracy benchmark v2

This benchmark defines relevance with catalog metadata. Labels are
`metadata_grounded`; they have no human semantic review. The original A1 data,
labels, image benchmark and embedding artifacts are preserved.

Rebuild from the unchanged 1,500-product catalog:

```sh
python -m scripts.build_accuracy_benchmark --products data/a1_abo_1500/products.jsonl --output evaluation/benchmarks/accuracy_v2 --seed 42
```

The frozen files contain 160 unique query strings: 60 predicate intents, each
with equivalent English and Vietnamese variants, plus 40 literal product-ID
probes. There are 20 intents each for category/brand, category/color and
category/brand/color. All 278 qrels have relevance 1 and cover 135 distinct
products. Every predicate has all matching positives from the full corpus,
with 1–20 positives; positives are never sampled or capped after selection.

`manifest.json` records each predicate, its positive count and Recall@10
ceiling, fixed aliases, corpus/query/qrel hashes, seed, exclusions and counts.
Category equality and brand equality are exact. Color matching uses stripped,
casefolded exact membership in the documented metadata values. English and
Vietnamese color phrases express that same predicate; no title substring or
inferred visual color supplies a label. Brand spelling stays exactly as stored
in the catalog, including distinct `AmazonBasics` and `Amazon Basics` strings.
Unknown, compound and unmatched colors do not satisfy a color predicate.

Before selecting queries, categories with an image identity reused across
category labels are excluded. Five shared-image groups implicate 13 categories
and 253 products. This conservative exclusion handles uncertain variants and
placeholders without removing any matching positive from a selected predicate.
The fixed aliases then support 43 of the corpus's 215 categories, covering 812
products. Sorted supported categories are shuffled with `random.Random(42)`;
the first `floor(0.7*43)=30` categories are development and the remaining 13 are
holdout. All queries and product variants within a category stay in its split.
Positive product IDs and known image identities are disjoint between splits.
Unrecorded product-family relationships have not been independently audited.

Candidate predicates are deterministically shuffled within each kind, with
up to 20 unique bilingual pairs selected per kind. Exact probes are sampled
after the category partition, up to 28 development and 12 holdout. The actual
query allocation is 130 development and 30 holdout; a category split does not
imply an identical query-count ratio. Use development only to select retrieval
configuration, then evaluate that fixed choice on holdout once. Freeze these
files before tuning; regenerate in a new benchmark version if definitions change.

Report nDCG@10, MRR@10 and Recall@10 by language, group and split, plus exact-ID
top-1 hit rate. nDCG@10 is primary: with N positives, Recall@10 cannot exceed
`min(10,N)/N`. Duplicate results occupy their returned rank and contribute zero
repeated gain. Primary runner means include failed attempts as zero; exported
`metrics_successful_only` and `success_rate` are diagnostics. Unknown semantic
grades stay null. RAG citation coverage measures citation presence, not support
for individual claims; fact-string coverage is only a proxy.

The corpus has main product images, without genuine alternate product views.
Transformed image queries remain identity diagnostics and cannot establish
independent visual relevance. This text benchmark also cannot establish human
answer accuracy, fine-grained shopping intent, or relevance for excluded
categories. Many predicates have a single positive; exact-ID results must be
reported separately from natural-language retrieval quality.
