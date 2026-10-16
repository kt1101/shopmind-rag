from __future__ import annotations

from typing import Protocol

from PIL import Image

from shopmind.app.api.errors import SearchApplicationError, SearchInfrastructureError, UnsupportedSearchMode
from shopmind.app.domain.search_query import SearchMode, SearchRequest
from shopmind.app.domain.search_result import RetrievedDocument, SearchResult
from shopmind.app.retrieval.base import Retriever


class _ImageRetriever(Protocol):
    def search_image(self, image: Image.Image, top_k: int = 10, candidate_k: int = 100, filters: dict[str, str | list[str]] | None = None) -> list[SearchResult]: ...


class SearchService:
    def __init__(self, *, bm25: Retriever, dense: Retriever, hybrid: Retriever, cross_modal: Retriever, image: _ImageRetriever) -> None:
        self._text_retrievers: dict[SearchMode, Retriever] = {SearchMode.BM25: bm25, SearchMode.DENSE: dense, SearchMode.HYBRID: hybrid, SearchMode.CROSS_MODAL: cross_modal}
        self._image_retriever = image

    def search_text(self, request: SearchRequest) -> list[SearchResult]:
        try:
            retriever = self._text_retrievers[request.mode]
        except KeyError as exc:
            raise UnsupportedSearchMode(f"unsupported search mode: {request.mode}") from exc
        try:
            return retriever.search(request)
        except SearchApplicationError:
            raise
        except Exception as exc:
            raise SearchInfrastructureError("search backend unavailable") from exc

    def search_image(self, image: Image.Image, top_k: int = 10, candidate_k: int = 100, filters: dict[str, str | list[str]] | None = None) -> list[SearchResult]:
        try:
            return self._image_retriever.search_image(image, top_k=top_k, candidate_k=candidate_k, filters=filters)
        except SearchApplicationError:
            raise
        except Exception as exc:
            raise SearchInfrastructureError("search backend unavailable") from exc

    @staticmethod
    def to_retrieved_documents(results: list[SearchResult]) -> list[RetrievedDocument]:
        return [RetrievedDocument(id=result.product_id, content=str(result.metadata.get("search_text", result.title)), score=result.score, source="product", metadata={**result.metadata, "title": result.title}) for result in results]
