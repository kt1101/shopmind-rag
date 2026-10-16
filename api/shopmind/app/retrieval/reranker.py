from __future__ import annotations

from typing import Protocol

from shopmind.app.domain.search_result import SearchResult


class Reranker(Protocol):
    def rerank(self, query: str, results: list[SearchResult], top_k: int) -> list[SearchResult]: ...


class NoOpReranker:
    def rerank(self, query: str, results: list[SearchResult], top_k: int) -> list[SearchResult]:
        del query
        if top_k <= 0:
            raise ValueError("top_k must be positive")
        return results[:top_k]
