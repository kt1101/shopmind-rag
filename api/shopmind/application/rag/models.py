from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from shopmind.domain.search_result import RetrievedDocument

SOURCES = ("product", "review", "policy")


@dataclass(frozen=True)
class RAGRequest:
    question: str
    product_id: str | None = None
    sources: tuple[str, ...] = SOURCES
    debug: bool = False

    def __post_init__(self) -> None:
        question = self.question.strip()
        if not question:
            raise ValueError("question is required")
        if self.product_id is not None and not self.product_id.strip():
            raise ValueError("product_id must be non-empty")
        if not self.sources or any(source not in SOURCES for source in self.sources):
            raise ValueError("invalid knowledge sources")
        object.__setattr__(self, "question", question)
        if self.product_id is not None:
            object.__setattr__(self, "product_id", self.product_id.strip())
        object.__setattr__(self, "sources", tuple(dict.fromkeys(self.sources)))


@dataclass(frozen=True)
class Citation:
    document_id: str
    source: str
    title: str
    score: float
    product_id: str | None = None
    policy_version: str | None = None
    source_url: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
    snippet: str | None = None
    image_url: str | None = None


@dataclass(frozen=True)
class RAGAnswer:
    answer: str
    sources: tuple[Citation, ...] = ()
    insufficient_evidence: bool = False
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class RAGContext:
    documents: tuple[RetrievedDocument, ...]
    rendered_context: str
    citation_ids: tuple[str, ...]
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class PreparedContext:
    context: RAGContext
    trace: dict[str, Any]
    started: float
    # The glass-box PipelineTrace active while preparing; generation (which may run on a
    # streaming worker thread, outside the request context) appends its steps to it.
    pipeline_trace: Any = None


@dataclass(frozen=True)
class GenerationDelta:
    text: str


@dataclass(frozen=True)
class GenerationReset:
    reason: str = "citation_retry"


@dataclass(frozen=True)
class GenerationFinal:
    answer: RAGAnswer
