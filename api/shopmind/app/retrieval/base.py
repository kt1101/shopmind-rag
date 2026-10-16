from __future__ import annotations

from typing import Protocol

from shopmind.app.domain.search_query import SearchRequest
from shopmind.app.domain.search_result import SearchResult


class Retriever(Protocol):
    def search(self, request: SearchRequest) -> list[SearchResult]:
        """Return strategy-ranked results for a validated request."""
        ...
