from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from shopmind.app.domain.search_result import RetrievalScores, SearchResult


@dataclass
class _Accumulator:
    product_id: str
    title: str
    score: float = 0.0
    metadata: dict[str, Any] = field(default_factory=dict)
    bm25_rank: int | None = None
    dense_rank: int | None = None
    reranker_score: float | None = None


def _min_rank(current: int | None, candidate: int | None) -> int | None:
    if candidate is None:
        return current
    return candidate if current is None else min(current, candidate)


def rrf_fuse(rankings: list[list[SearchResult]], k: int = 60, top_k: int = 10) -> list[SearchResult]:
    if k <= 0:
        raise ValueError("RRF k must be positive")
    if top_k <= 0:
        raise ValueError("top_k must be positive")
    accumulators: dict[str, _Accumulator] = {}
    for ranking in rankings:
        for result in ranking:
            if result.rank <= 0:
                raise ValueError("RRF input ranks must be positive")
            acc = accumulators.get(result.product_id)
            if acc is None:
                acc = _Accumulator(product_id=result.product_id, title=result.title, metadata=dict(result.metadata))
                accumulators[result.product_id] = acc
            else:
                for key in sorted(result.metadata):
                    acc.metadata.setdefault(key, result.metadata[key])
            acc.score += 1.0 / (k + result.rank)
            bm25_rank = result.retrieval_scores.bm25_rank
            dense_rank = result.retrieval_scores.dense_rank
            if bm25_rank is None and result.source == "bm25":
                bm25_rank = result.rank
            if dense_rank is None and result.source in {"dense", "cross_modal", "image_dense"}:
                dense_rank = result.rank
            acc.bm25_rank = _min_rank(acc.bm25_rank, bm25_rank)
            acc.dense_rank = _min_rank(acc.dense_rank, dense_rank)
            if result.retrieval_scores.reranker_score is not None:
                acc.reranker_score = result.retrieval_scores.reranker_score
    ordered = sorted(accumulators.values(), key=lambda item: (-item.score, item.product_id))[:top_k]
    return [SearchResult(product_id=item.product_id, title=item.title, rank=rank, score=item.score, source="hybrid", metadata=item.metadata, retrieval_scores=RetrievalScores(bm25_rank=item.bm25_rank, dense_rank=item.dense_rank, rrf_score=item.score, reranker_score=item.reranker_score)) for rank, item in enumerate(ordered, start=1)]
