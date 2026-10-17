from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator


class RAGAskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    product_id: str | None = Field(default=None, max_length=128)
    sources: list[Literal["product", "review", "policy"]] = Field(default_factory=lambda: ["product", "review", "policy"], min_length=1)
    debug: bool = False
    explain: bool = False

    @field_validator("question", "product_id")
    @classmethod
    def strip_nonempty(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if not value.strip():
            raise ValueError("value must be non-empty")
        return value.strip()


class RAGSourceResponse(BaseModel):
    """Contract ``Citation``: ``citation_id`` == ``document_id``; ``snippet`` is the cited evidence text."""
    citation_id: str | None = None
    document_id: str
    source: str
    title: str
    score: float
    product_id: str | None = None
    policy_version: str | None = None
    source_url: str | None = None
    url: str | None = None
    snippet: str | None = None
    image_url: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class RAGAskResponse(BaseModel):
    answer: str
    sources: list[RAGSourceResponse]
    insufficient_evidence: bool
    metadata: dict[str, Any] = Field(default_factory=dict)
    trace_id: str | None = None
    trace: dict[str, Any] | None = None


class CompareRequest(BaseModel):
    product_ids: list[str] = Field(min_length=2, max_length=3)
    question: str | None = Field(default=None, max_length=500)
    language: Literal["vi", "en"] = "vi"
    explain: bool = False


class CompareProduct(BaseModel):
    product_id: str
    title: str
    brand: str | None = None
    category: str | None = None
    image_url: str | None = None


class CompareAttribute(BaseModel):
    name: str
    values: dict[str, str | None]


class ComparePoint(BaseModel):
    text: str
    citation_ids: list[str]


class CompareResponse(BaseModel):
    products: list[CompareProduct]
    attributes: list[CompareAttribute]
    summary: str | None = None
    points: list[ComparePoint]
    sources: list[RAGSourceResponse]
    insufficient_evidence: bool
    llm_available: bool = True
    trace_id: str | None = None
    trace: dict[str, Any] | None = None
