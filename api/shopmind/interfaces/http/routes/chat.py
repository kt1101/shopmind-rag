from __future__ import annotations

import logging
import threading

from fastapi import APIRouter, Request

from shopmind.interfaces.http.routes.rag import RAGUnavailable
from shopmind.interfaces.http.schemas.chat import ChatRequest, ChatResponse
from shopmind.interfaces.http.sse import SSEResponse
from shopmind.application.chat.models import ChatTurn, PreparedChat
from shopmind.application.chat.service import answer_payload
from shopmind.core.logging import log_search_event

router = APIRouter(prefix="/api/v1/chat", tags=["chat"])
logger = logging.getLogger("shopmind.chat")


def _chat_service(request: Request):
    service = getattr(request.app.state, "chat_service", None)
    if service is None:
        raise RAGUnavailable("chat service is not ready")
    return service


def _prepare(service, payload: ChatRequest, request: Request, *, streamed: bool) -> PreparedChat:
    prepared = service.prepare(payload.message, [ChatTurn(turn.role, turn.content) for turn in payload.history], payload.product_id)
    log_search_event(
        logger,
        event="chat_prepared",
        request_id=getattr(request.state, "request_id", None),
        message_length=len(payload.message),
        history_length=len(payload.history),
        standalone_length=len(prepared.standalone_question),
        rewrite_fallback=prepared.rewrite_fallback,
        sources=list(prepared.request.sources),
        source_counts=prepared.prepared.trace.get("source_counts"),
        streamed=streamed,
    )
    return prepared


@router.post("", response_model=ChatResponse)
def chat(payload: ChatRequest, request: Request) -> ChatResponse:
    service = _chat_service(request)
    prepared = _prepare(service, payload, request, streamed=False)
    answer = service.answer(prepared)
    log_search_event(
        logger,
        event="chat_answered",
        request_id=getattr(request.state, "request_id", None),
        generation_attempts=answer.metadata.get("generation_attempts"),
        latency_ms=answer.metadata.get("total_ms"),
    )
    return ChatResponse(**answer_payload(answer, prepared.standalone_question))


@router.post("/stream")
def chat_stream(payload: ChatRequest, request: Request) -> SSEResponse:
    service = _chat_service(request)
    prepared = _prepare(service, payload, request, streamed=True)
    cancelled = threading.Event()
    return SSEResponse(service.stream(prepared, cancelled), cancelled)
