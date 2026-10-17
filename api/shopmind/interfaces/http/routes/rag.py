from __future__ import annotations

from dataclasses import asdict
from time import perf_counter

from fastapi import APIRouter, Depends, Request

from shopmind.application.rag.compare import CompareError
from shopmind.application.rag.planner import PlanRequestError
from shopmind.application.rag.models import RAGRequest
from shopmind.interfaces.http.deps import component, traced, wants_explain
from shopmind.interfaces.http.errors import register_error
from shopmind.interfaces.http.ratelimit import rate_limit
from shopmind.interfaces.http.schemas.rag import CompareRequest, CompareResponse, PlanRequest, PlanResponse, RAGAskRequest, RAGAskResponse, RAGSourceResponse

router = APIRouter(prefix="/api/v1/rag", tags=["rag"], dependencies=[Depends(rate_limit)])


class RAGUnavailable(RuntimeError):
    pass


register_error(CompareError, 422, "invalid_compare_request")
register_error(PlanRequestError, 422, "invalid_plan_request")


def _rag_service(request: Request):
    service = component(request, "rag_service")
    if service is None:
        raise RAGUnavailable("RAG service is not ready")
    return service


def _record(request: Request, trace, *, kind: str, latency_ms: float, insufficient: bool, query: str) -> None:
    event_log = component(request, "event_log")
    if event_log is None:
        return
    try:
        event_log.record_chat(trace.trace_id, None, kind, latency_ms, insufficient, query=query, pipeline=trace.pipeline, kind=kind)
    except Exception:
        pass


@router.post("/ask", response_model=RAGAskResponse)
def ask(payload: RAGAskRequest, request: Request) -> RAGAskResponse:
    service = _rag_service(request)
    explain = wants_explain(request, payload.explain)
    started = perf_counter()
    with traced(request, "rag.answer", kind="rag", input={"question": payload.question, "product_id": payload.product_id, "sources": list(payload.sources)}, verbose=explain) as trace:
        answer = service.answer(RAGRequest(payload.question, product_id=payload.product_id, sources=tuple(payload.sources), debug=payload.debug))
        trace.set_output(answer=answer.answer, citation_ids=[source.document_id for source in answer.sources], insufficient_evidence=answer.insufficient_evidence)
    _record(request, trace, kind="rag", latency_ms=(perf_counter() - started) * 1000, insufficient=answer.insufficient_evidence, query=payload.question)
    return RAGAskResponse(
        answer=answer.answer,
        sources=[RAGSourceResponse.model_validate({**asdict(source), "citation_id": source.document_id, "url": source.source_url}) for source in answer.sources],
        insufficient_evidence=answer.insufficient_evidence,
        metadata=answer.metadata if payload.debug else {},
        trace_id=trace.trace_id,
        trace=trace.to_dict() if explain else None,
    )


@router.post("/compare", response_model=CompareResponse)
def compare(payload: CompareRequest, request: Request) -> CompareResponse:
    """F3: attribute table from catalog data + a cited RAG comparison of 2-3 products."""
    service = component(request, "compare_service")
    if service is None:
        raise RAGUnavailable("compare service is not ready")
    explain = wants_explain(request, payload.explain)
    started = perf_counter()
    with traced(request, "rag.compare", kind="compare", input={"product_ids": payload.product_ids, "question": payload.question}, verbose=explain) as trace:
        result = service.compare(payload.product_ids, payload.question, language=payload.language)
        trace.set_output(summary=result.get("summary"), points=len(result.get("points") or []))
    _record(request, trace, kind="compare", latency_ms=(perf_counter() - started) * 1000, insufficient=bool(result.get("insufficient_evidence")), query=payload.question or " vs ".join(payload.product_ids))
    return CompareResponse(**result, trace_id=trace.trace_id, trace=trace.to_dict() if explain else None)


@router.post("/plan", response_model=PlanResponse)
def plan(payload: PlanRequest, request: Request) -> PlanResponse:
    """F6: situation + budget → needs → per-need retrieval → budget optimization → cited reasons."""
    service = component(request, "planner")
    if service is None:
        raise RAGUnavailable("shopping planner is not ready")
    explain = wants_explain(request, payload.explain)
    started = perf_counter()
    with traced(request, "rag.plan", kind="plan", input={"request": payload.request, "budget": payload.budget, "max_needs": payload.max_needs}, verbose=explain) as trace:
        result = service.plan(payload.request, budget=payload.budget, language=payload.language, max_needs=payload.max_needs)
        trace.set_output(total=result["total"], budget=result["budget"], chosen=[(need["chosen"] or {}).get("product_id") for need in result["needs"]])
    _record(request, trace, kind="plan", latency_ms=(perf_counter() - started) * 1000, insufficient=bool(result.get("insufficient_evidence")), query=payload.request)
    return PlanResponse(**result, trace_id=trace.trace_id, trace=trace.to_dict() if explain else None)
