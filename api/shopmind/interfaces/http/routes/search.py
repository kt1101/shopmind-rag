from __future__ import annotations

import logging
from io import BytesIO
from time import perf_counter
from typing import Any

from fastapi import APIRouter, Depends, File, Form, Query, Request, UploadFile
from PIL import Image, UnidentifiedImageError

from shopmind.interfaces.http.deps import component, get_config, traced, wants_explain
from shopmind.interfaces.http.errors import ImageTooLarge, InvalidFilter, InvalidImage, InvalidPagination, SearchInfrastructureError
from shopmind.interfaces.http.schemas.search import ComposeSearchResponse, FacetsRequest, FacetsResponse, FilterOptionsResponse, ImageSearchResponse, ProductSearchResult, SuggestResponse, TextSearchRequest, TextSearchResponse, UnderstandRequest, UnderstandResponse, normalize_filters
from shopmind.core.logging import log_search_event
from shopmind.application.search.service import SearchService

router = APIRouter(prefix="/api/v1/search", tags=["search"])
logger = logging.getLogger("shopmind.search")


def get_search_service(request: Request) -> SearchService:
    service = component(request, "search_service")
    if service is None:
        raise SearchInfrastructureError("search service is not ready")
    return service


def get_repository(request: Request):
    repository = component(request, "repository")
    if repository is None or not hasattr(repository, "filter_options"):
        raise SearchInfrastructureError("search repository is not ready")
    return repository


def _collapse_singleton_filters(filters: dict[str, str | list[str]]) -> dict[str, str | list[str]]:
    return {key: value[0] if isinstance(value, list) and len(value) == 1 else value for key, value in filters.items()}


async def read_image(request: Request, image: UploadFile) -> Image.Image:
    """Validate and decode an uploaded image (content type, size limit, decodability)."""
    if not image.content_type or not image.content_type.lower().startswith("image/"):
        raise InvalidImage("uploaded file must have an image content type")
    max_bytes = int(getattr(request.app.state, "max_image_bytes", 5 * 1024 * 1024))
    raw = await image.read(max_bytes + 1)
    if len(raw) > max_bytes:
        raise ImageTooLarge(f"image exceeds configured maximum of {max_bytes} bytes")
    try:
        with Image.open(BytesIO(raw)) as decoded:
            return decoded.convert("RGB").copy()
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise InvalidImage("uploaded bytes are not a valid image") from exc


def _pipeline_name(service: Any, kind: str, domain_request: Any = None) -> str:
    namer = getattr(service, "pipeline_name", None)
    if namer is None:
        return f"search.{domain_request.mode.value}" if domain_request is not None else f"search.{kind}"
    try:
        return namer(kind, domain_request)
    except KeyError:
        return f"search.{kind}"


def _record(request: Request, *, trace_id: str, query: str | None, mode: str, pipeline: str, latency_ms: float, result_count: int, filters: dict | None = None) -> None:
    event_log = component(request, "event_log")
    if event_log is None:
        return
    try:
        event_log.record_search(trace_id=trace_id, query=query, mode=mode, pipeline=pipeline, latency_ms=latency_ms, result_count=result_count, filters=filters or {})
    except Exception:  # analytics must never break search
        logger.warning("search event logging failed", exc_info=True)


def _inline(trace, explain: bool) -> dict[str, Any] | None:
    return trace.to_dict() if explain else None


@router.post("/text", response_model=TextSearchResponse, response_model_exclude_none=True)
def search_text(payload: TextSearchRequest, request: Request, service: SearchService = Depends(get_search_service)) -> TextSearchResponse:
    started = perf_counter()
    domain_request = payload.to_domain()
    explain = wants_explain(request, payload.explain)
    pipeline = _pipeline_name(service, "text", domain_request)
    with traced(request, pipeline, kind="search", input={"query": domain_request.query, "mode": domain_request.mode.value, "filters": domain_request.filters, "top_k": payload.top_k, "offset": payload.offset}, verbose=explain) as trace:
        results = service.search_text(domain_request)[payload.offset:]
        if payload.sort == "title":
            results = sorted(results, key=lambda result: result.title.casefold())
        trace.set_output(result_ids=[result.product_id for result in results])
    latency_ms = round((perf_counter() - started) * 1000, 3)
    log_search_event(logger, request_id=request.state.request_id, query=domain_request.query, mode=domain_request.mode.value, pipeline=pipeline, latency_ms=latency_ms, candidate_k=domain_request.candidate_k, result_count=len(results), index_alias=getattr(request.app.state, "index_alias", None), embedding_model=getattr(request.app.state, "embedding_model", None), embedding_version=getattr(request.app.state, "embedding_version", None))
    _record(request, trace_id=trace.trace_id, query=domain_request.query, mode=domain_request.mode.value, pipeline=pipeline, latency_ms=latency_ms, result_count=len(results), filters=domain_request.filters)
    return TextSearchResponse(query=domain_request.query, mode=domain_request.mode.value, filter_only=domain_request.query is None, results=[ProductSearchResult.from_domain(result) for result in results], pipeline=pipeline, trace_id=trace.trace_id, trace=_inline(trace, explain))


@router.get("/filter-options", response_model=FilterOptionsResponse)
def filter_options(field: str = Query(...), prefix: str = Query(default="", max_length=64), limit: int = Query(default=20, ge=1, le=50), repository=Depends(get_repository)) -> FilterOptionsResponse:
    try:
        options = repository.filter_options(field=field, prefix=prefix.strip(), limit=limit)
    except ValueError as exc:
        raise InvalidFilter(str(exc)) from exc
    return FilterOptionsResponse(field=field, options=options)


@router.post("/image", response_model=ImageSearchResponse, response_model_exclude_none=True)
async def search_image(request: Request, image: UploadFile = File(...), top_k: int = Query(default=10, gt=0), candidate_k: int = Query(default=100, gt=0), offset: int = Query(default=0, ge=0), brand: list[str] | None = Query(default=None), category: list[str] | None = Query(default=None), product_id: str | None = Query(default=None), explain: bool = Query(default=False), service: SearchService = Depends(get_search_service)) -> ImageSearchResponse:
    if candidate_k < top_k:
        raise InvalidImage("candidate_k must be >= top_k")
    if offset + top_k > candidate_k:
        raise InvalidPagination("offset + top_k must be <= candidate_k")
    rgb = await read_image(request, image)
    filters = _collapse_singleton_filters(normalize_filters({"brand": brand, "category": category, "product_id": product_id}))
    started = perf_counter()
    pipeline = _pipeline_name(service, "image")
    with traced(request, pipeline, kind="image_search", input={"image": {"size": list(rgb.size)}, "filters": filters, "top_k": top_k}, verbose=explain) as trace:
        results = service.search_image(rgb, top_k=offset + top_k, candidate_k=candidate_k, filters=filters)[offset:]
        trace.set_output(result_ids=[result.product_id for result in results])
    latency_ms = round((perf_counter() - started) * 1000, 3)
    log_search_event(logger, request_id=request.state.request_id, mode="image_dense", latency_ms=latency_ms, candidate_k=candidate_k, result_count=len(results), index_alias=getattr(request.app.state, "index_alias", None), embedding_model=getattr(request.app.state, "embedding_model", None), embedding_version=getattr(request.app.state, "embedding_version", None))
    _record(request, trace_id=trace.trace_id, query=None, mode="image", pipeline=pipeline, latency_ms=latency_ms, result_count=len(results), filters=filters)
    return ImageSearchResponse(results=[ProductSearchResult.from_domain(result) for result in results], trace_id=trace.trace_id, trace=_inline(trace, explain))


@router.post("/compose", response_model=ComposeSearchResponse, response_model_exclude_none=True)
async def search_compose(request: Request, image: UploadFile = File(...), text: str = Form(..., min_length=1, max_length=500), alpha: float | None = Form(default=None, ge=0, le=1), top_k: int = Form(default=12, gt=0, le=100), candidate_k: int = Form(default=100, gt=0, le=500), explain: bool = Query(default=False), service: SearchService = Depends(get_search_service)) -> ComposeSearchResponse:
    """F1: "like this image, but <text>" — q = normalize(α·image + (1−α)·text) in SigLIP2 space."""
    if candidate_k < top_k:
        raise InvalidPagination("candidate_k must be >= top_k")
    rgb = await read_image(request, image)
    config = get_config(request)
    weight = alpha if alpha is not None else (config.features.compose_default_alpha if config is not None else 0.7)
    started = perf_counter()
    pipeline = _pipeline_name(service, "compose")
    with traced(request, pipeline, kind="compose_search", input={"text": text, "alpha": weight, "image": {"size": list(rgb.size)}, "top_k": top_k}, verbose=explain or wants_explain(request)) as trace:
        results = service.search_compose(rgb, text, alpha=weight, top_k=top_k, candidate_k=candidate_k)
        trace.set_output(result_ids=[result.product_id for result in results])
    latency_ms = round((perf_counter() - started) * 1000, 3)
    _record(request, trace_id=trace.trace_id, query=text, mode="compose", pipeline=pipeline, latency_ms=latency_ms, result_count=len(results))
    return ComposeSearchResponse(text=text, alpha=weight, results=[ProductSearchResult.from_domain(result) for result in results], trace_id=trace.trace_id, trace=_inline(trace, explain or wants_explain(request)))


@router.get("/suggest", response_model=SuggestResponse, response_model_exclude_none=True)
def suggest(q: str = Query(default="", max_length=100), limit: int = Query(default=8, ge=1, le=20), repository=Depends(get_repository)) -> SuggestResponse:
    suggestions = repository.suggest(q, limit) if hasattr(repository, "suggest") else []
    return SuggestResponse(query=q, suggestions=suggestions)


@router.post("/facets", response_model=FacetsResponse)
def facets(payload: FacetsRequest, repository=Depends(get_repository)) -> FacetsResponse:
    unknown = sorted(set(payload.filters) - {"brand", "category", "color"})
    if unknown:
        raise InvalidFilter(f"unsupported facet filter: {unknown[0]}")
    if not hasattr(repository, "facets"):
        raise SearchInfrastructureError("facets are not supported by this repository")
    return FacetsResponse(facets=repository.facets(payload.query, payload.filters))


@router.post("/understand", response_model=UnderstandResponse)
def understand(payload: UnderstandRequest, request: Request) -> UnderstandResponse:
    """F2: what the assistant would extract from a sentence (intent, filters, rewritten query)."""
    understanding = component(request, "query_understanding")
    if understanding is None:
        from shopmind.application.chat.intents import RuleQueryUnderstanding

        understanding = RuleQueryUnderstanding()
    result = understanding.understand(payload.query)
    return UnderstandResponse(**{key: value for key, value in result.to_dict().items()})
