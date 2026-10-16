from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints

from shopmind.app.api.schemas.rag import RAGSourceResponse


class ChatTurnIn(BaseModel):
    role: Literal["user", "assistant"]
    content: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4000)]


class ChatRequest(BaseModel):
    message: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]
    history: list[ChatTurnIn] = Field(default_factory=list, max_length=12)
    product_id: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=128)] | None = None


class ChatResponse(BaseModel):
    answer: str
    sources: list[RAGSourceResponse]
    insufficient_evidence: bool
    standalone_question: str
