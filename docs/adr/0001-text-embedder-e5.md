# ADR 0001: Dedicated multilingual text embedder (E5) for text-to-text retrieval

- Status: Accepted
- Date: 2026-10-16
- Related: [REFACTOR_PLAN.md](../REFACTOR_PLAN.md) §1.2, §4 (A-1, A-2, A-6)

## Context

SigLIP2 (`google/siglip2-base-patch16-224`) currently embeds both images and product text. It was
trained for text-to-image matching, truncates text at 64 tokens, and is weak on Vietnamese. On the A1
seed-42 benchmark (`reports/a1/RESULTS.md`, 80 text queries) dense text retrieval reaches
Recall@10 = 0.0125 against 0.4625 for BM25, and BM25 + dense + RRF drops to 0.3250. The dense
component therefore makes hybrid search worse than lexical search, and every feature built on dense
retrieval (semantic search, RAG retrieval, adaptive mode) inherits the problem.

## Decision

Add a separate text embedder, registered as `embedder: sentence_transformer`, configured by default with
`intfloat/multilingual-e5-base` and its `query: ` / `passage: ` prefixes. It produces `text_vector` for
products, reviews and policies. SigLIP2 keeps `image_vector`, image search, cross-modal search and
compose search.

- The model id, prefixes and embedding text template live in config, not in code.
- Embedding artifacts are generated per embedder (`data/embeddings/<version>/`, manifest records the
  embedder id), so switching embedder means a new artifact + new versioned index + alias switch.
- The dependency is the optional `text-embed` extra (`sentence-transformers`), installed in the API image.

## Consequences

- Positive: a model trained for text retrieval, multilingual (vi/en), longer input; a fair chance for
  hybrid RRF to be at least as good as BM25. Success criterion: dense Recall@10 > BM25 on the semantic
  query group and hybrid ≥ BM25 overall, reported from `metrics.json`.
- Negative: a second model to load (more RAM, slower cold start), `text_vector` dims change (768 → model
  dims), so indexes must be rebuilt; embeddings must be regenerated offline in the CPU container.
- The old SigLIP text space stays available for comparison in the embedding map and ablation.

## Alternatives considered

- **Keep SigLIP2 for text, tune fusion** (`lexical_preserving`, weights): hides the symptom, does not fix
  semantic or Vietnamese queries.
- **`BAAI/bge-m3`**: strong multilingual model, but larger (≈568M params) and slower on CPU; kept as a
  config-only alternative to measure.
- **Hosted embedding API (OpenAI)**: good quality but adds cost, network dependency and an API key to
  search, which must keep working offline.
- **Fine-tuning**: out of scope (Won't).

## Outcome (2026-10-17)

Implemented as `embedders.text_e5` (`sentence_transformer`, `intfloat/multilingual-e5-base`) with the
SigLIP2 text space kept as `siglip_text_vector` for comparison. On the A1 seed-42 benchmark (80 text
queries, `api/reports/a1/RESULTS.md`): dense Recall@10 0.0375 (SigLIP2 text) → 0.5500 (E5), against
0.4875 for BM25; hybrid linear fusion reaches 0.5875. On the accuracy_v2 holdout the DEV-selected hybrid
reaches nDCG@10 0.6961 versus 0.6075 for the previous lexical-preserving setting. Labels are seed /
metadata labels that still need human review.
