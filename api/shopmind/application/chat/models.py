from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from shopmind.application.rag.models import PreparedContext, RAGRequest


@dataclass(frozen=True)
class ChatTurn:
    role: str
    content: str


@dataclass(frozen=True)
class PreparedChat:
    standalone_question: str
    rewrite_fallback: bool
    request: RAGRequest
    prepared: PreparedContext


@dataclass(frozen=True)
class ChatEvent:
    event: str
    data: dict[str, Any]
