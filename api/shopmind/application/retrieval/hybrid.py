from __future__ import annotations

from dataclasses import replace

from shopmind.domain.search_query import SearchRequest
from shopmind.domain.search_result import RetrievalScores, SearchResult
from shopmind.application.retrieval.base import Retriever
from shopmind.application.retrieval.fusion import rrf_fuse
from shopmind.application.retrieval.reranker import NoOpReranker, Reranker


class HybridRetriever:
    def __init__(self, bm25: Retriever, dense: Retriever, reranker: Reranker, rrf_k: int = 60, *, lexical_preserving: bool = False) -> None:
        if rrf_k <= 0:
            raise ValueError("rrf_k must be positive")
        self.bm25 = bm25
        self.dense = dense
        self.reranker = reranker
        self.rrf_k = rrf_k
        self.lexical_preserving = lexical_preserving

    def search(self, request: SearchRequest) -> list[SearchResult]:
        if hasattr(self.bm25, "exact_id_search"):
            exact = self.bm25.exact_id_search(request)
            if exact:
                return [replace(result, rank=1, source="hybrid", metadata={**result.metadata, "ordering_policy": "exact_id"}) for result in exact]
        candidate_request = replace(request, top_k=request.candidate_k, candidate_k=request.candidate_k)
        bm25_results = self.bm25.search(candidate_request)
        exact = [result for result in bm25_results if request.query and result.product_id.casefold() == request.query.strip().casefold()]
        if exact:
            return [replace(result, rank=1, source="hybrid", metadata={**result.metadata, "ordering_policy": "exact_id"}) for result in exact]
        if self.lexical_preserving and type(self.reranker) is NoOpReranker and len(bm25_results) >= request.top_k:
            return [replace(result, rank=rank, source="hybrid", metadata={**result.metadata, "ordering_policy": "lexical_preserving"}, retrieval_scores=RetrievalScores(bm25_rank=result.retrieval_scores.bm25_rank or result.rank)) for rank, result in enumerate(bm25_results[:request.top_k], start=1)]
        dense_results = self.dense.search(candidate_request)
        fused = rrf_fuse([bm25_results, dense_results], k=self.rrf_k, top_k=request.candidate_k * (2 if self.lexical_preserving else 1))
        if self.lexical_preserving:
            by_id = {result.product_id: result for result in fused}
            lexical_ids = {result.product_id for result in bm25_results}
            fused = [by_id[result.product_id] for result in bm25_results] + [result for result in fused if result.product_id not in lexical_ids]
        reranked = self.reranker.rerank(request.query, fused, request.top_k)
        return [replace(result, rank=rank, source="hybrid", metadata={**result.metadata, "ordering_policy": "lexical_preserving" if self.lexical_preserving else "rrf"}) for rank, result in enumerate(reranked[: request.top_k], start=1)]
