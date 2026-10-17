from __future__ import annotations

import logging
import threading
from time import perf_counter

from fastapi import APIRouter, Depends, File, Request, UploadFile

from shopmind.interfaces.http.deps import component, save_trace, traced, wants_explain
from shopmind.interfaces.http.errors import SearchInfrastructureError
from shopmind.interfaces.http.ratelimit import rate_limit
from shopmind.interfaces.http.routes.rag import RAGUnavailable
from shopmind.interfaces.http.routes.search import read_image
from shopmind.interfaces.http.schemas.chat import ChatImageResponse, ChatRequest, ChatResponse, ChatSessionResponse
from shopmind.interfaces.http.sse import SSEResponse
from shopmind.application.chat.models import ChatTurn, PreparedChat
from shopmind.application.chat.service import answer_payload
from shopmind.core.logging import log_search_event

router = APIRouter(prefix="/api/v1/chat", tags=["chat"])
logger = logging.getLogger("shopmind.chat")


def _chat_service(request: Request):
    service = component(request, "chat_service")
    if service is None:
        raise RAGUnavailable("chat service is not ready")
    return service


def _prepare(service, payload: ChatRequest, request: Request, *, streamed: bool) -> PreparedChat:
    prepared = service.prepare(payload.message, [ChatTurn(turn.role, turn.content) for turn in payload.history], payload.product_id, image_token=payload.image_token, session_id=payload.session_id)
    log_search_event(
        logger,
        event="chat_prepared",
        request_id=getattr(request.state, "request_id", None),
        message_length=len(payload.message),
        history_length=len(payload.history),
        standalone_length=len(prepared.standalone_question),
        rewrite_fallback=prepared.rewrite_fallback,
        intent=prepared.intent,
        sources=list(prepared.request.sources) if prepared.request is not None else [],
        source_counts=prepared.prepared.trace.get("source_counts") if prepared.prepared is not None else None,
        streamed=streamed,
    )
    return prepared


def _record(request: Request, trace_id: str, prepared: PreparedChat, latency_ms: float, insufficient: bool) -> None:
    event_log = component(request, "event_log")
    if event_log is None:
        return
    try:
        event_log.record_chat(trace_id, prepared.session_id, prepared.intent, latency_ms, insufficient, query=prepared.message, pipeline="chat.assistant")
    except Exception:
        logger.warning("chat event logging failed", exc_info=True)


@router.post("", response_model=ChatResponse, dependencies=[Depends(rate_limit)])
def chat(payload: ChatRequest, request: Request) -> ChatResponse:
    service = _chat_service(request)
    explain = wants_explain(request, payload.explain)
    started = perf_counter()
    with traced(request, "chat.assistant", kind="chat", input={"message": payload.message, "history_turns": len(payload.history), "product_id": payload.product_id, "image": bool(payload.image_token)}, verbose=explain) as trace:
        prepared = _prepare(service, payload, request, streamed=False)
        answer = service.answer(prepared)
        trace.set_output(intent=prepared.intent, answer=answer.answer, citation_ids=[source.document_id for source in answer.sources], product_ids=[item.product_id for item in prepared.products])
    log_search_event(
        logger,
        event="chat_answered",
        request_id=getattr(request.state, "request_id", None),
        generation_attempts=answer.metadata.get("generation_attempts"),
        latency_ms=answer.metadata.get("total_ms"),
    )
    _record(request, trace.trace_id, prepared, (perf_counter() - started) * 1000, answer.insufficient_evidence)
    return ChatResponse(**answer_payload(answer, prepared.standalone_question, prepared), trace_id=trace.trace_id, trace=trace.to_dict() if explain else None)


@router.post("/stream", dependencies=[Depends(rate_limit)])
def chat_stream(payload: ChatRequest, request: Request) -> SSEResponse:
    service = _chat_service(request)
    explain = wants_explain(request, payload.explain)
    started = perf_counter()
    # Preparation (intent, search, rewrite, retrieval, context) runs before the stream starts so its
    # failures are plain HTTP errors; generation steps are appended to the same trace while streaming.
    with traced(request, "chat.assistant", kind="chat", input={"message": payload.message, "history_turns": len(payload.history), "product_id": payload.product_id, "image": bool(payload.image_token)}, verbose=explain, persist=False) as trace:
        prepared = _prepare(service, payload, request, streamed=True)
    cancelled = threading.Event()

    def on_finish(done: PreparedChat, answer) -> dict | None:
        trace.finish()
        if answer is not None:
            trace.set_output(intent=done.intent, answer=answer.answer, citation_ids=[source.document_id for source in answer.sources], product_ids=[item.product_id for item in done.products])
            _record(request, trace.trace_id, done, (perf_counter() - started) * 1000, answer.insufficient_evidence)
        save_trace(request, trace)
        return {"trace": trace.to_dict()} if explain and answer is not None else None

    return SSEResponse(service.stream(prepared, cancelled, trace_id=trace.trace_id, on_finish=on_finish), cancelled)


@router.post("/image", response_model=ChatImageResponse, dependencies=[Depends(rate_limit)])
async def upload_chat_image(request: Request, image: UploadFile = File(...)) -> ChatImageResponse:
    """Upload a photo for the assistant; the chat body references it with ``image_token``."""
    cache = component(request, "image_cache")
    if cache is None:
        raise SearchInfrastructureError("chat images are not available")
    rgb = await read_image(request, image)
    return ChatImageResponse(image_token=cache.put(rgb), expires_in=int(cache.ttl_seconds))


@router.get("/sessions/{session_id}", response_model=ChatSessionResponse)
def chat_session(session_id: str, request: Request) -> ChatSessionResponse:
    store = component(request, "chat_store")
    messages = list(store.get(session_id) or []) if store is not None else []
    return ChatSessionResponse(session_id=session_id, messages=messages)
