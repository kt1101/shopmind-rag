from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class RawSearchHit:
    product_id: str
    title: str
    score: float
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class RetrievalScores:
    bm25_rank: int | None = None
    dense_rank: int | None = None
    rrf_score: float | None = None
    reranker_score: float | None = None


@dataclass(frozen=True)
class SearchResult:
    product_id: str
    title: str
    rank: int
    score: float
    source: str
    metadata: dict[str, Any] = field(default_factory=dict)
    retrieval_scores: RetrievalScores = field(default_factory=RetrievalScores)


@dataclass(frozen=True)
class RetrievedDocument:
    id: str
    content: str
    score: float
    source: str
    metadata: dict[str, Any] = field(default_factory=dict)
