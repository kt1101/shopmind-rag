from __future__ import annotations

import logging
import threading
from collections.abc import Callable, Iterator, Sequence
from dataclasses import asdict
from typing import Any

from shopmind.app.chat.models import ChatEvent, ChatTurn, PreparedChat
from shopmind.app.core.config import ChatConfig
from shopmind.app.llm.base import InvalidLLMOutput, LLMProviderError
from shopmind.app.rag.models import GenerationDelta, GenerationFinal, GenerationReset, RAGAnswer, RAGRequest
from shopmind.app.rag.service import RAGGenerationError

logger = logging.getLogger("shopmind.chat")


def answer_payload(answer: RAGAnswer, standalone_question: str) -> dict[str, Any]:
    return {
        "answer": answer.answer,
        "sources": [asdict(citation) for citation in answer.sources],
        "insufficient_evidence": answer.insufficient_evidence,
        "standalone_question": standalone_question,
    }


class ChatService:
    def __init__(
        self,
        rag_service,
        config: ChatConfig,
        review_available: Callable[[], bool],
        product_title: Callable[[str], str | None],
    ) -> None:
        self.rag_service = rag_service
        self.config = config
        self.review_available = review_available
        self.product_title = product_title

    def sources(self) -> tuple[str, ...]:
        sources = list(self.config.sources)
        if self.config.include_reviews_when_available and "review" not in sources and self._reviews_available():
            sources.append("review")
        return tuple(sources)

    def prepare(self, message: str, history: Sequence[ChatTurn], product_id: str | None) -> PreparedChat:
        llm = self.rag_service.llm
        if llm is None:
            raise LLMProviderError("OPENAI_API_KEY is not configured")
        question, fallback = message, False
        if history:
            try:
                question = llm.rewrite_question(
                    [(turn.role, turn.content) for turn in history],
                    message,
                    self._product_hint(product_id),
                )
            except (LLMProviderError, InvalidLLMOutput):
                question, fallback = message, True
        request = RAGRequest(question, product_id=product_id, sources=self.sources())
        return PreparedChat(question, fallback, request, self.rag_service.prepare(request))

    def answer(self, prepared: PreparedChat) -> RAGAnswer:
        return self.rag_service.generate(prepared.request, prepared.prepared)

    def stream(self, prepared: PreparedChat, cancelled: threading.Event) -> Iterator[ChatEvent]:
        yield ChatEvent("meta", {"standalone_question": prepared.standalone_question, "rewrite_fallback": prepared.rewrite_fallback})
        try:
            final: RAGAnswer | None = None
            for item in self.rag_service.generate_stream(prepared.request, prepared.prepared, cancelled):
                if isinstance(item, GenerationDelta):
                    yield ChatEvent("delta", {"text": item.text})
                elif isinstance(item, GenerationReset):
                    yield ChatEvent("reset", {"reason": item.reason})
                elif isinstance(item, GenerationFinal):
                    final = item.answer
            if final is None:
                if cancelled.is_set():
                    return
                raise RAGGenerationError("answer stream ended without a final answer")
            yield ChatEvent("done", answer_payload(final, prepared.standalone_question))
        except (RAGGenerationError, InvalidLLMOutput):
            yield ChatEvent("error", {"code": "rag_generation_failed", "message": "answer generation failed"})
        except LLMProviderError:
            yield ChatEvent("error", {"code": "llm_unavailable", "message": "language model unavailable"})
        except Exception:
            logger.exception("chat generation failed")
            yield ChatEvent("error", {"code": "internal_error", "message": "chat generation failed"})

    def _reviews_available(self) -> bool:
        try:
            return bool(self.review_available())
        except Exception:
            logger.warning("review alias availability check failed; reviews excluded", exc_info=True)
            return False

    def _product_hint(self, product_id: str | None) -> tuple[str, str] | None:
        if not product_id:
            return None
        try:
            title = self.product_title(product_id)
        except Exception:
            return None
        return (product_id, title) if title else None
