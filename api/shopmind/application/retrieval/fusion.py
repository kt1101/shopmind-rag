from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from shopmind.domain.search_result import RetrievalScores, SearchResult


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


_DENSE_SOURCES = {"dense", "cross_modal", "image_dense", "compose", "dense_siglip"}


def _weight_for(weights: list[float] | dict[str, float] | None, position: int, name: str) -> float:
    if weights is None:
        return 1.0
    if isinstance(weights, dict):
        return float(weights.get(name, 1.0))
    return float(weights[position]) if position < len(weights) else 1.0


def fuse_named_rankings(rankings: dict[str, list[SearchResult]], *, method: str = "rrf", k: int = 60, weights: list[float] | dict[str, float] | None = None, top_k: int = 10) -> list[SearchResult]:
    """Fuse named rankings (``{"lexical": [...], "semantic": [...]}``) with per-ranking weights (A-4).

    ``rrf``: ``score = Σ wᵢ / (k + rankᵢ)``. ``linear``: min-max normalise each ranking's scores to
    [0, 1] and take ``Σ wᵢ · normᵢ`` (missing = 0). Every fused result carries ``metadata.contributions``
    (``{name: {rank, score}}``) and ``metadata.formula`` so the inspector can show the arithmetic.
    """
    if method not in {"rrf", "linear"}:
        raise ValueError(f"unsupported fusion method: {method}")
    if k <= 0 or top_k <= 0:
        raise ValueError("k and top_k must be positive")
    totals: dict[str, float] = {}
    first: dict[str, SearchResult] = {}
    contributions: dict[str, dict[str, dict[str, float]]] = {}
    terms: dict[str, list[str]] = {}
    ranks: dict[str, dict[str, int | None]] = {}
    for position, (name, ranking) in enumerate(rankings.items()):
        weight = _weight_for(weights, position, name)
        scores = [result.score for result in ranking]
        low, high = (min(scores), max(scores)) if scores else (0.0, 0.0)
        for result in ranking:
            if result.rank <= 0:
                raise ValueError("fusion input ranks must be positive")
            if method == "rrf":
                part = weight / (k + result.rank)
                term = f"{weight:g}/({k}+{result.rank})" if weight != 1.0 else f"1/({k}+{result.rank})"
            else:
                normalized = 1.0 if high == low else (result.score - low) / (high - low)
                part = weight * normalized
                term = f"{weight:g}×{normalized:.3f}"
            pid = result.product_id
            if pid not in first:
                first[pid] = result
            else:
                merged = dict(first[pid].metadata)
                for key in sorted(result.metadata):
                    merged.setdefault(key, result.metadata[key])
                first[pid] = SearchResult(first[pid].product_id, first[pid].title, first[pid].rank, first[pid].score, first[pid].source, merged, first[pid].retrieval_scores)
            totals[pid] = totals.get(pid, 0.0) + part
            contributions.setdefault(pid, {})[name] = {"rank": result.rank, "score": round(part, 6)}
            terms.setdefault(pid, []).append(term)
            slot = ranks.setdefault(pid, {"bm25": None, "dense": None})
            if result.source == "bm25" or result.retrieval_scores.bm25_rank is not None:
                slot["bm25"] = _min_rank(slot["bm25"], result.retrieval_scores.bm25_rank or result.rank)
            if result.source in _DENSE_SOURCES or result.retrieval_scores.dense_rank is not None:
                slot["dense"] = _min_rank(slot["dense"], result.retrieval_scores.dense_rank or result.rank)
    ordered = sorted(totals, key=lambda pid: (-totals[pid], pid))[:top_k]
    output = []
    for rank, pid in enumerate(ordered, start=1):
        base = first[pid]
        metadata = {**base.metadata, "contributions": contributions[pid], "formula": " + ".join(terms[pid]) + f" = {totals[pid]:.5f}"}
        output.append(SearchResult(product_id=pid, title=base.title, rank=rank, score=totals[pid], source="hybrid", metadata=metadata, retrieval_scores=RetrievalScores(bm25_rank=ranks[pid]["bm25"], dense_rank=ranks[pid]["dense"], rrf_score=totals[pid] if method == "rrf" else None, reranker_score=base.retrieval_scores.reranker_score)))
    return output
