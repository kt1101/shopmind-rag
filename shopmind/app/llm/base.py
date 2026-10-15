from __future__ import annotations

import threading
from collections.abc import Iterator, Sequence
from dataclasses import dataclass, field
from typing import Any, Protocol


class LLMProviderError(RuntimeError):
    pass


class InvalidLLMOutput(ValueError):
    pass


@dataclass(frozen=True)
class LLMRequest:
    question: str
    rendered_context: str
    allowed_citation_ids: tuple[str, ...]
    instructions: str
    schema_version: str = "rag_answer_v1"


@dataclass(frozen=True)
class LLMResponse:
    answer: str
    citation_ids: tuple[str, ...]
    insufficient_evidence: bool
    metadata: dict[str, Any] = field(default_factory=dict)


class LLMProvider(Protocol):
    def generate(self, request: LLMRequest) -> LLMResponse: ...

    def generate_stream(self, request: LLMRequest, cancelled: threading.Event | None = None) -> Iterator[str | LLMResponse]: ...

    def rewrite_question(self, history: Sequence[tuple[str, str]], message: str, product: tuple[str, str] | None = None) -> str: ...
