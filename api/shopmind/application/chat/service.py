from __future__ import annotations

import logging
import threading
import uuid
from collections.abc import Callable, Iterator, Sequence
from dataclasses import asdict
from typing import Any

from shopmind.application.chat.models import ChatEvent, ChatTurn, PreparedChat
from shopmind.application.retrieval.language import detect_language
from shopmind.core.config import ChatConfig
from shopmind.core.logging import log_search_event
from shopmind.core.tracing import current_trace, trace_step
from shopmind.domain.search_query import SearchMode, SearchRequest
from shopmind.infrastructure.llm.base import InvalidLLMOutput, LLMProviderError
from shopmind.application.rag.models import GenerationDelta, GenerationFinal, GenerationReset, RAGAnswer, RAGRequest
from shopmind.application.rag.service import RAGGenerationError

logger = logging.getLogger("shopmind.chat")

HELP_TEXT = {
    "vi": "Chào bạn! Mình là trợ lý mua sắm ShopMind. Bạn có thể nhờ mình tìm sản phẩm (ví dụ: \"tìm sofa xám\"), gửi ảnh để tìm món tương tự, hỏi về một sản phẩm hoặc về chính sách đổi trả, giao hàng (chính sách là dữ liệu thử nghiệm).",
    "en": "Hi! I'm the ShopMind shopping assistant. Ask me to find products (e.g. \"find a grey sofa\"), attach a photo to find similar items, or ask about a product or the (experimental) store policies.",
}


def citation_payload(citation: Any) -> dict[str, Any]:
    """API contract ``Citation`` (additive over the original fields)."""
    data = asdict(citation)
    data["citation_id"] = data["document_id"]
    data["url"] = data.get("source_url")
    return data


def product_payload(result: Any) -> dict[str, Any]:
    metadata = getattr(result, "metadata", {}) or {}
    return {"product_id": result.product_id, "title": result.title, "image_url": metadata.get("image_url"), "brand": metadata.get("brand"), "category": metadata.get("category"), "score": result.score, "rank": result.rank}


def answer_payload(answer: RAGAnswer, standalone_question: str, prepared: PreparedChat | None = None) -> dict[str, Any]:
    payload = {
        "answer": answer.answer,
        "sources": [citation_payload(citation) for citation in answer.sources],
        "insufficient_evidence": answer.insufficient_evidence,
        "standalone_question": standalone_question,
    }
    if prepared is not None:
        payload.update(session_id=prepared.session_id, intent=prepared.intent, products=[product_payload(item) for item in prepared.products])
    return payload


_IMAGE_REFERENCE_WORDS = {"tìm", "kiếm", "giống", "như", "ảnh", "hình", "này", "tương", "tự", "cái", "món", "sản", "phẩm", "đồ", "find", "search", "similar", "like", "this", "that", "photo", "image", "picture", "one", "item", "show", "me", "something", "the", "a", "to", "cho", "mình", "tôi", "xem"}


def _describes_change(text: str) -> bool:
    """True when the text adds something beyond "find something like this photo"."""
    return any(word not in _IMAGE_REFERENCE_WORDS for word in text.casefold().replace(",", " ").split())


class ChatService:
    """History-aware assistant over RAG, with optional one-step intent routing (F2).

    With ``understanding`` + ``search`` configured, ``product_search``/``compare`` messages are
    answered with product cards (no LLM call), ``chitchat`` with a fixed help text, and questions
    go through RAG as before. Every stage records a glass-box step in the active trace.
    """

    def __init__(self, rag_service, config: ChatConfig, review_available: Callable[[], bool], product_title: Callable[[str], str | None], *, understanding=None, search=None, image_cache=None, store=None, commerce=None, max_products: int = 6) -> None:
        self.rag_service = rag_service
        self.config = config
        self.review_available = review_available
        self.product_title = product_title
        self.understanding = understanding
        self.search = search
        self.image_cache = image_cache
        self.store = store
        self.commerce = commerce
        self.max_products = max_products

    def sources(self) -> tuple[str, ...]:
        sources = list(self.config.sources)
        if self.config.include_reviews_when_available and "review" not in sources and self._reviews_available():
            sources.append("review")
        return tuple(sources)

    # --- preparation ---------------------------------------------------------------------------

    def prepare(self, message: str, history: Sequence[ChatTurn], product_id: str | None, *, image_token: str | None = None, session_id: str | None = None) -> PreparedChat:
        session_id = session_id or uuid.uuid4().hex
        trace = current_trace()
        image = self.image_cache.get(image_token) if image_token and self.image_cache is not None else None
        if image_token and image is None:
            from shopmind.interfaces.http.errors import InvalidImage

            raise InvalidImage("image_token is unknown or expired; upload the image again")
        understanding = None
        intent = "product_question"
        if self.understanding is not None:
            with trace_step("route_intent", impl=getattr(self.understanding, "method", "rules")) as step:
                understood = self.understanding.understand(message, has_image=image is not None, product_id=product_id)
                understanding = understood.to_dict()
                intent = understood.intent
                step.set_details(**understanding)
                step.set_summary(f"intent {intent}: {understood.reason}")
                for span in understood.spans:
                    step.note(f"'{span['text']}' → {span['filter']} = {span['value']}")
            if intent == "chitchat":
                answer = RAGAnswer(HELP_TEXT[detect_language(message)], (), False, {"generation_attempts": 0})
                return PreparedChat(message, False, None, None, intent, answer, (), session_id, understanding, trace, message)
            if intent in {"product_search", "compare"} and self.search is not None:
                products, notes = self._search_products(understood, image)
                answer = RAGAnswer(self._products_answer(message, products, understood, notes, intent), (), not products, {"generation_attempts": 0})
                return PreparedChat(message, False, None, None, intent, answer, tuple(products), session_id, understanding, trace, message)
        llm = self.rag_service.llm
        if llm is None:
            raise LLMProviderError("OPENAI_API_KEY is not configured")
        question, fallback = message, False
        if history:
            with trace_step("rewrite", impl="llm") as step:
                try:
                    question = llm.rewrite_question([(turn.role, turn.content) for turn in history], message, self._product_hint(product_id))
                except (LLMProviderError, InvalidLLMOutput):
                    question, fallback = message, True
                step.set_details(original=message, standalone=question, fallback=fallback, history_turns=len(history))
                step.set_summary("rewrite failed: original message used" if fallback else f"standalone question: {question}")
        request = RAGRequest(question, product_id=product_id, sources=self.sources())
        return PreparedChat(question, fallback, request, self.rag_service.prepare(request), intent, None, (), session_id, understanding, trace, message)

    def _search_products(self, understood, image) -> tuple[list[Any], list[str]]:
        notes: list[str] = []
        filters = {key: list(values) for key, values in understood.filters.items()}
        text = understood.rewritten_query.strip()
        candidate_k = max(self.max_products * 5, 50)
        if image is not None:
            if _describes_change(text) or understood.filters:
                results = self.search.search_compose(image, text, top_k=self.max_products, candidate_k=candidate_k, filters={key: value for key, value in filters.items() if key != "color"})
                notes.append("compose")
            else:
                results = self.search.search_image(image, top_k=self.max_products, candidate_k=candidate_k)
                notes.append("image")
        else:
            query = text or understood.query
            results = self._text_search(query, filters, candidate_k)
            if not results and filters:
                notes.append("relaxed_filters")
                results = self._text_search(understood.query, {}, candidate_k)
        if understood.price and self.commerce is not None:
            results, dropped = self._price_filter(results, understood.price)
            if dropped:
                notes.append(f"price_filtered:{dropped}")
        return list(results[: self.max_products]), notes

    def _text_search(self, query: str, filters: dict[str, list[str]], candidate_k: int) -> list[Any]:
        try:
            return self.search.search_text(SearchRequest(query=query, mode=SearchMode.HYBRID, top_k=candidate_k, candidate_k=candidate_k, filters=filters))
        except Exception:
            if not filters:
                raise
            return []

    def _price_filter(self, results, price: dict[str, float]):
        try:
            overlay = self.commerce.get_many([result.product_id for result in results]) or {}
        except Exception:
            return results, 0
        kept = []
        for result in results:
            amount = ((overlay.get(result.product_id) or {}).get("price") or {}).get("amount")
            if amount is None or (("max" not in price or amount <= price["max"]) and ("min" not in price or amount >= price["min"])):
                kept.append(result)
        return kept, len(results) - len(kept)

    def _products_answer(self, message: str, products, understood, notes: list[str], intent: str) -> str:
        vi = detect_language(message) == "vi"
        if not products:
            return "Mình chưa tìm thấy sản phẩm phù hợp. Bạn thử mô tả khác hoặc bỏ bớt điều kiện nhé." if vi else "I couldn't find a matching product. Try different words or fewer constraints."
        understood_parts = [f"{name}: {', '.join(values)}" for name, values in understood.filters.items()]
        if understood.price:
            understood_parts.append("giá " + ", ".join(f"{key} {value:g}" for key, value in understood.price.items()) + " (giá tổng hợp)" if vi else "price " + ", ".join(f"{key} {value:g}" for key, value in understood.price.items()) + " (synthetic prices)")
        lines = []
        if intent == "compare":
            lines.append("Đây là các sản phẩm liên quan; chọn 2–3 sản phẩm rồi bấm \"So sánh\" để xem bảng so sánh có trích dẫn:" if vi else "Here are related products; pick 2-3 and press \"Compare\" for a cited comparison:")
        else:
            lines.append(f"Mình tìm được {len(products)} sản phẩm phù hợp:" if vi else f"I found {len(products)} matching products:")
        for index, product in enumerate(products, start=1):
            brand = (getattr(product, "metadata", {}) or {}).get("brand")
            lines.append(f"{index}. {product.title}" + (f" ({brand})" if brand else ""))
        if understood_parts:
            lines.append(("Mình đã hiểu: " if vi else "Understood: ") + "; ".join(understood_parts) + ".")
        if "relaxed_filters" in notes:
            lines.append("Không có kết quả khớp đúng bộ lọc nên mình đã nới điều kiện." if vi else "No exact match for the filters, so they were relaxed.")
        if "compose" in notes:
            lines.append("Kết quả kết hợp ảnh của bạn với mô tả bằng chữ." if vi else "Results combine your photo with the text description.")
        return "\n".join(lines)

    # --- answering -----------------------------------------------------------------------------

    def answer(self, prepared: PreparedChat) -> RAGAnswer:
        answer = prepared.direct_answer if prepared.direct_answer is not None else self.rag_service.generate(prepared.request, prepared.prepared)
        self._remember(prepared, answer)
        return answer

    def stream(self, prepared: PreparedChat, cancelled: threading.Event, *, trace_id: str | None = None, on_finish: Callable[[PreparedChat, RAGAnswer | None], dict[str, Any] | None] | None = None) -> Iterator[ChatEvent]:
        """Yield meta, step, products, delta/reset events, then done or one final error event.

        Returns silently when ``cancelled`` is set. Emits exactly one ``chat_streamed``
        log event when the stream ends, including when the consumer closes it early
        (outcome ``cancelled``). An exception thrown in at a ``yield`` (for example an
        SSE serialization failure) is reported as ``internal_error``. ``on_finish`` runs once
        with the final answer (persist the trace, events…) and may return extra ``done`` fields.
        """
        outcome = "cancelled"  # kept when generation is cancelled or the consumer closes the stream
        attempts: Any = None
        total_ms: Any = None
        error_type: str | None = None
        emitted_steps = 0
        final: RAGAnswer | None = None

        def new_steps() -> Iterator[ChatEvent]:
            nonlocal emitted_steps
            steps = getattr(prepared.pipeline_trace, "steps", None) or []
            for step in steps[emitted_steps:]:
                yield ChatEvent("step", {"id": step.id or step.step, "step": step.step, "status": "done" if step.status in {"ok", "rejected"} else step.status, "summary": step.summary, "duration_ms": round(step.duration_ms, 3)})
            emitted_steps = len(steps)

        try:
            try:
                meta = {"standalone_question": prepared.standalone_question, "rewrite_fallback": prepared.rewrite_fallback}
                if self.understanding is not None or prepared.session_id:
                    meta.update(session_id=prepared.session_id, intent=prepared.intent, trace_id=trace_id)
                yield ChatEvent("meta", meta)
                yield from new_steps()
                if prepared.products:
                    yield ChatEvent("products", {"items": [product_payload(item) for item in prepared.products]})
                if prepared.direct_answer is not None:
                    final = prepared.direct_answer
                    yield ChatEvent("delta", {"text": final.answer})
                else:
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
                yield from new_steps()
                outcome = "done"
                attempts, total_ms = final.metadata.get("generation_attempts"), final.metadata.get("total_ms")
                self._remember(prepared, final)
                extra = on_finish(prepared, final) if on_finish is not None else None
                done = answer_payload(final, prepared.standalone_question, prepared if meta.get("session_id") else None)
                if meta.get("session_id"):
                    done["trace_id"] = trace_id
                yield ChatEvent("done", {**done, **(extra or {})})
            except (RAGGenerationError, InvalidLLMOutput) as exc:
                outcome, error_type = "rag_generation_failed", type(exc).__name__
                logger.warning("chat generation failed (%s): %s", outcome, error_type)
                yield ChatEvent("error", {"code": outcome, "message": "answer generation failed"})
            except LLMProviderError as exc:
                outcome, error_type = "llm_unavailable", type(exc).__name__
                logger.warning("chat generation failed (%s): %s", outcome, error_type)
                yield ChatEvent("error", {"code": outcome, "message": "language model unavailable"})
            except Exception as exc:
                outcome, error_type = "internal_error", type(exc).__name__
                logger.exception("chat generation failed")
                yield ChatEvent("error", {"code": outcome, "message": "chat generation failed"})
        finally:
            if outcome != "done" and on_finish is not None:
                try:
                    on_finish(prepared, None)
                except Exception:
                    logger.warning("chat stream finalizer failed", exc_info=True)
            log_search_event(
                logger,
                event="chat_streamed",
                outcome=outcome,
                generation_attempts=attempts,
                total_ms=total_ms,
                error_type=error_type,
            )

    def history(self, session_id: str) -> list[dict[str, Any]]:
        if self.store is None:
            return []
        return list(self.store.get(session_id) or [])

    def _remember(self, prepared: PreparedChat, answer: RAGAnswer) -> None:
        if self.store is None or not prepared.session_id:
            return
        try:
            self.store.append(prepared.session_id, "user", prepared.message or prepared.standalone_question, {"intent": prepared.intent})
            self.store.append(prepared.session_id, "assistant", answer.answer, {"sources": [citation_payload(citation) for citation in answer.sources], "products": [product_payload(item) for item in prepared.products], "intent": prepared.intent})
        except Exception:
            logger.warning("chat history persistence failed", exc_info=True)

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
