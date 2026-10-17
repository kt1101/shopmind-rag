from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from shopmind.interfaces.http.deps import get_config, require_auth, traced
from shopmind.interfaces.http.routes.search import _pipeline_name, get_search_service
from shopmind.interfaces.http.schemas.search import DebugSearchResponse, DebugSearchResult, TextSearchRequest
from shopmind.application.search.service import SearchService

router = APIRouter(prefix="/api/v1/debug", tags=["debug"], dependencies=[Depends(require_auth)])


def _rrf_k(request: Request, pipeline: str) -> int:
    config = get_config(request)
    spec = config.pipelines.get(pipeline) if config is not None else None
    for step in getattr(spec, "steps", []) or []:
        if step.step == "fuse" and "k" in step.params:
            return int(step.params["k"])
    return int(getattr(request.app.state, "fusion_rrf_k", 60))


@router.post("/search", response_model=DebugSearchResponse)
def debug_search(payload: TextSearchRequest, request: Request, service: SearchService = Depends(get_search_service)) -> DebugSearchResponse:
    """Per-component scores (kept for compatibility); the full step trace is in ``trace``."""
    domain_request = payload.to_domain()
    pipeline = _pipeline_name(service, "text", domain_request)
    with traced(request, pipeline, kind="search", input={"query": domain_request.query, "mode": domain_request.mode.value, "filters": domain_request.filters}, verbose=True) as trace:
        results = service.search_text(domain_request)[payload.offset:]
    rrf_k = _rrf_k(request, pipeline)
    return DebugSearchResponse(
        query=domain_request.query, mode=domain_request.mode.value, filter_only=domain_request.query is None,
        rrf_k=rrf_k, results=[DebugSearchResult.from_domain(result, rrf_k=rrf_k) for result in results], trace=trace.to_dict(),
    )
