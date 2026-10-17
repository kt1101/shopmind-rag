from __future__ import annotations

from dataclasses import replace
from typing import Any, Protocol

from PIL import Image

from shopmind.interfaces.http.errors import SearchApplicationError, SearchInfrastructureError, UnsupportedSearchMode
from shopmind.domain.search_query import SearchMode, SearchRequest
from shopmind.domain.search_result import RetrievedDocument, SearchResult
from shopmind.application.retrieval.base import Retriever

# Default pipeline per public mode; overridable with config ``defaults: {mode.<mode>: <pipeline>}``.
DEFAULT_MODE_PIPELINES = {
    "bm25": "search.bm25", "dense": "search.dense", "hybrid": "search.hybrid",
    "cross_modal": "search.cross_modal", "adaptive": "search.adaptive",
    "image": "search.image", "compose": "search.compose", "similar": "search.similar",
}


class _ImageRetriever(Protocol):
    def search_image(self, image: Image.Image, top_k: int = 10, candidate_k: int = 100, filters: dict[str, str | list[str]] | None = None) -> list[SearchResult]: ...


class SearchService:
    """A1 product search.

    With ``pipelines`` (a ``PipelineFactory``) every mode runs a config-declared pipeline through
    the traced engine; ``routes`` maps ``mode.<mode>`` → pipeline name. Without it the injected
    retrievers are used directly (unit tests, legacy callers).
    """

    def __init__(self, *, bm25: Retriever | None = None, dense: Retriever | None = None, hybrid: Retriever | None = None, cross_modal: Retriever | None = None, image: _ImageRetriever | None = None, pipelines: Any | None = None, routes: dict[str, str] | None = None) -> None:
        self._text_retrievers: dict[SearchMode, Retriever] = {mode: retriever for mode, retriever in {SearchMode.BM25: bm25, SearchMode.DENSE: dense, SearchMode.HYBRID: hybrid, SearchMode.CROSS_MODAL: cross_modal}.items() if retriever is not None}
        self._image_retriever = image
        self.pipelines = pipelines
        self.routes = {**DEFAULT_MODE_PIPELINES, **{key.removeprefix("mode."): value for key, value in (routes or {}).items() if key.startswith("mode.")}}

    # --- pipeline selection --------------------------------------------------------------------

    def pipeline_name(self, kind: str, request: SearchRequest | None = None) -> str:
        if request is not None and request.pipeline:
            return request.pipeline
        if request is not None and not request.query:
            return self.routes["bm25"]  # filter-only listing
        key = request.mode.value if request is not None and kind == "text" else kind
        return self.routes[key]

    def _run(self, name: str, request: SearchRequest, state: dict[str, Any] | None = None) -> list[SearchResult]:
        from shopmind.application.pipeline import PipelineContext

        try:
            pipeline = self.pipelines.get(name)
        except KeyError as exc:
            raise UnsupportedSearchMode(f"unknown search pipeline: {name}") from exc
        try:
            ctx = pipeline.run(PipelineContext(request=request, state=dict(state or {})))
        except SearchApplicationError:
            raise
        except Exception as exc:
            raise SearchInfrastructureError("search backend unavailable") from exc
        # Text pipelines report the requested mode (public contract); visual ones keep the step label.
        relabel = pipeline.spec.kind == "search"
        return [replace(result, rank=rank, source=request.mode.value if relabel else result.source) for rank, result in enumerate(ctx.results[: request.top_k], start=1)]

    # --- public API ----------------------------------------------------------------------------

    def search_text(self, request: SearchRequest) -> list[SearchResult]:
        if self.pipelines is not None:
            if request.pipeline is None and request.mode.value not in self.routes:
                raise UnsupportedSearchMode(f"unsupported search mode: {request.mode}")
            return self._run(self.pipeline_name("text", request), request)
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
        if self.pipelines is not None:
            request = _VisualRequest(top_k=top_k, candidate_k=candidate_k, filters=dict(filters or {}))
            return self._run(self.routes["image"], request, {"image": image})
        try:
            return self._image_retriever.search_image(image, top_k=top_k, candidate_k=candidate_k, filters=filters)
        except SearchApplicationError:
            raise
        except Exception as exc:
            raise SearchInfrastructureError("search backend unavailable") from exc

    def search_compose(self, image: Image.Image, text: str, *, alpha: float | None = None, top_k: int = 10, candidate_k: int = 100, filters: dict[str, str | list[str]] | None = None) -> list[SearchResult]:
        """F1: "like this image, but <text>" (weighted SigLIP2 image + text query)."""
        if self.pipelines is None:
            raise UnsupportedSearchMode("compose search requires the pipeline engine")
        request = _VisualRequest(query=text.strip() or None, top_k=top_k, candidate_k=candidate_k, filters=dict(filters or {}))
        return self._run(self.routes["compose"], request, {"image": image, "alpha": alpha})

    def similar(self, product_id: str, vector: list[float], *, limit: int = 8) -> list[SearchResult]:
        """Visually similar products: image kNN around a product's own image vector (self excluded)."""
        if self.pipelines is None:
            raise UnsupportedSearchMode("similar items require the pipeline engine")
        import numpy as np

        request = _VisualRequest(top_k=limit, candidate_k=max(limit * 3, 24), filters={})
        return self._run(self.routes["similar"], request, {"query_vector": np.asarray(vector, dtype="float32"), "exclude_ids": [product_id]})

    @staticmethod
    def to_retrieved_documents(results: list[SearchResult]) -> list[RetrievedDocument]:
        return [RetrievedDocument(id=result.product_id, content=str(result.metadata.get("search_text", result.title)), score=result.score, source="product", metadata={**result.metadata, "title": result.title}) for result in results]


class _VisualRequest:
    """Request object for image / compose / similar pipelines (no text-mode validation)."""

    mode = SearchMode.DENSE
    pipeline = None

    def __init__(self, *, query: str | None = None, top_k: int = 10, candidate_k: int = 100, filters: dict[str, Any] | None = None) -> None:
        if top_k <= 0 or candidate_k < top_k:
            raise ValueError("candidate_k must be >= positive top_k")
        self.query = query
        self.top_k = top_k
        self.candidate_k = candidate_k
        self.filters = filters or {}
