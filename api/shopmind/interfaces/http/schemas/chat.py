from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field, StringConstraints

from shopmind.interfaces.http.schemas.rag import RAGSourceResponse


class ChatTurnIn(BaseModel):
    role: Literal["user", "assistant"]
    content: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4000)]


class ChatRequest(BaseModel):
    message: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]
    history: list[ChatTurnIn] = Field(default_factory=list, max_length=12)
    product_id: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=128)] | None = None
    session_id: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)] | None = None
    image_token: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)] | None = None
    explain: bool = False


class ChatProduct(BaseModel):
    product_id: str
    title: str
    image_url: str | None = None
    brand: str | None = None
    category: str | None = None
    score: float
    rank: int


class ChatResponse(BaseModel):
    answer: str
    sources: list[RAGSourceResponse]
    insufficient_evidence: bool
    standalone_question: str
    session_id: str | None = None
    intent: str | None = None
    products: list[ChatProduct] | None = None
    trace_id: str | None = None
    trace: dict[str, Any] | None = None


class ChatImageResponse(BaseModel):
    image_token: str
    expires_in: int


class ChatSessionResponse(BaseModel):
    session_id: str
    messages: list[dict[str, Any]]
