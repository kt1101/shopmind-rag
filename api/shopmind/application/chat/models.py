from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from shopmind.application.rag.models import PreparedContext, RAGAnswer, RAGRequest


@dataclass(frozen=True)
class ChatTurn:
    role: str
    content: str


@dataclass(frozen=True)
class PreparedChat:
    standalone_question: str
    rewrite_fallback: bool
    request: RAGRequest | None
    prepared: PreparedContext | None
    intent: str = "product_question"
    # Answered without the LLM (product search, chitchat): the final answer is already known.
    direct_answer: RAGAnswer | None = None
    products: tuple[Any, ...] = ()
    session_id: str | None = None
    understanding: dict[str, Any] | None = None
    pipeline_trace: Any = None
    message: str = ""
    extra: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ChatEvent:
    event: str
    data: dict[str, Any]
