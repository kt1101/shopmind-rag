from __future__ import annotations

from typing import Protocol

from shopmind.domain.search_result import RetrievalScores, SearchResult


class Reranker(Protocol):
    def rerank(self, query: str, results: list[SearchResult], top_k: int) -> list[SearchResult]: ...


class NoOpReranker:
    def rerank(self, query: str, results: list[SearchResult], top_k: int) -> list[SearchResult]:
        del query
        if top_k <= 0:
            raise ValueError("top_k must be positive")
        return results[:top_k]


def _result_text(result: SearchResult) -> str:
    metadata = result.metadata
    return str(metadata.get("search_text") or "\n".join(str(part) for part in (result.title, metadata.get("brand"), metadata.get("category")) if part))


class CrossEncoderReranker:
    """A-5: cross-encoder reranking for A1 product results (lazy model load, ``rag-rerank`` extra)."""

    def __init__(self, model_name: str, *, max_characters: int = 1000, model=None) -> None:
        self.model_name = model_name
        self.max_characters = max_characters
        self._model = model

    def _load(self):
        if self._model is None:
            try:
                from sentence_transformers import CrossEncoder
            except ImportError as exc:
                raise RuntimeError("install the rag-rerank extra to enable the cross-encoder reranker") from exc
            self._model = CrossEncoder(self.model_name)
        return self._model

    def rerank(self, query: str, results: list[SearchResult], top_k: int) -> list[SearchResult]:
        if top_k <= 0:
            raise ValueError("top_k must be positive")
        if not results or not query:
            return results[:top_k]
        scores = self._load().predict([(query, _result_text(result)[: self.max_characters]) for result in results])
        scored = sorted(zip(results, scores, strict=True), key=lambda item: (-float(item[1]), item[0].rank))
        output = []
        for rank, (result, score) in enumerate(scored[:top_k], start=1):
            scores_ = RetrievalScores(result.retrieval_scores.bm25_rank, result.retrieval_scores.dense_rank, result.retrieval_scores.rrf_score, float(score))
            output.append(SearchResult(result.product_id, result.title, rank, float(score), result.source, {**result.metadata, "before_rank": result.rank, "after_rank": rank, "reranker_score": round(float(score), 6)}, scores_))
        return output


class AttributeBoostReranker:
    """Boost results whose attributes match values named in the query (F1 compose: "màu đen").

    ``wanted`` maps attribute name → canonical values (e.g. ``{"color": {"black"}}``); a match adds
    ``boost`` to the score. Matching uses the canonical colour vocabulary, so ``Nero``/``đen`` = black.
    """

    def __init__(self, boost: float = 0.05) -> None:
        self.boost = boost

    def rerank(self, results: list[SearchResult], wanted: dict[str, set[str]], top_k: int, normalize=None) -> list[SearchResult]:
        if not wanted:
            return results[:top_k]
        normalize = normalize or (lambda field, value: value.casefold())
        rescored = []
        for result in results:
            attributes = result.metadata.get("attributes") if isinstance(result.metadata.get("attributes"), dict) else {}
            matched = [field for field, values in wanted.items() if attributes.get(field) and normalize(field, str(attributes[field])) in values]
            rescored.append((result, result.score + self.boost * len(matched), matched))
        ordered = sorted(rescored, key=lambda item: (-item[1], item[0].rank))
        return [SearchResult(result.product_id, result.title, rank, score, result.source, {**result.metadata, "before_rank": result.rank, "after_rank": rank, "boosted": matched}, result.retrieval_scores) for rank, (result, score, matched) in enumerate(ordered[:top_k], start=1)]
