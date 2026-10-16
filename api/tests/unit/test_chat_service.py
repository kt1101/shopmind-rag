from __future__ import annotations

import json
import logging
import threading

import pytest

from shopmind.application.chat.models import ChatTurn
from shopmind.application.chat.service import ChatService, answer_payload
from shopmind.core.config import ChatConfig
from shopmind.infrastructure.llm.base import InvalidLLMOutput, LLMProviderError
from shopmind.application.rag.models import Citation, GenerationDelta, GenerationFinal, GenerationReset, PreparedContext, RAGAnswer
from shopmind.application.rag.service import RAGGenerationError

ANSWER = RAGAnswer("Final text", (Citation("D1", "policy", "Returns", 0.5, policy_version="v1"),), False, {"x": 1})


class FakeLLM:
    def __init__(self, result="Standalone question?", error=None):
        self.result = result
        self.error = error
        self.rewrite_calls = []

    def rewrite_question(self, history, message, product=None):
        self.rewrite_calls.append({"history": list(history), "message": message, "product": product})
        if self.error:
            raise self.error
        return self.result


class FakeRAG:
    def __init__(self, llm, events=None, error=None):
        self.llm = llm
        self.events = events if events is not None else []
        self.error = error
        self.prepared_requests = []
        self.stream_cancelled = []

    def prepare(self, request):
        self.prepared_requests.append(request)
        return PreparedContext(context=None, trace={}, started=0.0)

    def generate(self, request, prepared):
        return ANSWER

    def generate_stream(self, request, prepared, cancelled=None):
        self.stream_cancelled.append(cancelled)
        for event in self.events:
            yield event
        if self.error:
            raise self.error


def make(llm=None, rag=None, *, config=None, review=lambda: False, title=lambda pid: "Klepe Navy Runner"):
    llm = llm if llm is not None else FakeLLM()
    rag = rag if rag is not None else FakeRAG(llm)
    return ChatService(rag, config or ChatConfig(), review, title), llm, rag


HISTORY = [ChatTurn("user", "Tell me about P1"), ChatTurn("assistant", "It is a shoe.")]


def test_no_history_skips_rewrite():
    svc, llm, rag = make()
    p = svc.prepare("What is the return policy?", [], None)
    assert llm.rewrite_calls == []
    assert p.standalone_question == "What is the return policy?" and p.rewrite_fallback is False
    assert rag.prepared_requests[-1].question == "What is the return policy?"


def test_rewrite_gets_viewed_product_and_request_product_scopes_retrieval():
    svc, llm, rag = make()
    p = svc.prepare("Is it waterproof?", HISTORY, product_id="P2")
    assert llm.rewrite_calls[-1]["product"] == ("P2", "Klepe Navy Runner")
    assert llm.rewrite_calls[-1]["history"] == [("user", "Tell me about P1"), ("assistant", "It is a shoe.")]
    assert p.standalone_question == "Standalone question?"
    assert rag.prepared_requests[-1].product_id == "P2" and rag.prepared_requests[-1].question == p.standalone_question


def test_no_product_id_passes_no_hint():
    svc, llm, _ = make(title=lambda pid: pytest.fail("must not look up"))
    svc.prepare("and shoes?", HISTORY, None)
    assert llm.rewrite_calls[-1]["product"] is None


@pytest.mark.parametrize("error", [LLMProviderError("down"), InvalidLLMOutput("bad")])
def test_rewrite_failure_falls_back_to_message(error):
    svc, _, rag = make(FakeLLM(error=error))
    p = svc.prepare("and for shoes?", HISTORY, None)
    assert p.standalone_question == "and for shoes?" and p.rewrite_fallback is True
    assert rag.prepared_requests[-1].question == "and for shoes?"


@pytest.mark.parametrize("title", [lambda pid: (_ for _ in ()).throw(RuntimeError("es down")), lambda pid: None, lambda pid: ""])
def test_product_title_lookup_failure_or_missing_omits_hint(title):
    svc, llm, rag = make(title=title)
    svc.prepare("Is it waterproof?", HISTORY, "P2")
    assert llm.rewrite_calls[-1]["product"] is None
    assert rag.prepared_requests[-1].product_id == "P2"


def test_reviews_added_only_when_alias_exists_and_check_errors_count_as_absent(caplog):
    assert make(review=lambda: True)[0].sources() == ("product", "policy", "review")
    assert make(review=lambda: False)[0].sources() == ("product", "policy")
    assert make(review=lambda: True, config=ChatConfig(include_reviews_when_available=False))[0].sources() == ("product", "policy")
    assert make(review=lambda: True, config=ChatConfig(sources=["product", "review"]))[0].sources() == ("product", "review")

    def boom():
        raise RuntimeError("es down")

    with caplog.at_level(logging.WARNING, logger="shopmind.chat"):
        assert make(review=boom)[0].sources() == ("product", "policy")
    assert any(r.name == "shopmind.chat" for r in caplog.records)


def test_prepare_uses_sources_in_request():
    svc, _, rag = make(review=lambda: True)
    svc.prepare("q", [], None)
    assert rag.prepared_requests[-1].sources == ("product", "policy", "review")


def test_missing_llm_raises_before_retrieval():
    rag = FakeRAG(None)
    svc = ChatService(rag, ChatConfig(), lambda: pytest.fail("no source check"), lambda pid: pytest.fail("no lookup"))
    with pytest.raises(LLMProviderError, match="OPENAI_API_KEY"):
        svc.prepare("hi", HISTORY, "P1")
    assert rag.prepared_requests == []


def test_answer_delegates_to_generate():
    svc, _, _ = make()
    assert svc.answer(svc.prepare("q", [], None)) is ANSWER


def test_answer_payload_shape():
    payload = answer_payload(ANSWER, "sq")
    assert payload == {
        "answer": "Final text",
        "sources": [{"document_id": "D1", "source": "policy", "title": "Returns", "score": 0.5, "product_id": None, "policy_version": "v1", "source_url": None, "metadata": {}}],
        "insufficient_evidence": False,
        "standalone_question": "sq",
    }


def test_stream_event_sequence():
    events = [GenerationDelta("Fin"), GenerationReset(), GenerationDelta("Final text"), GenerationFinal(ANSWER)]
    svc, _, rag = make(rag=FakeRAG(FakeLLM(), events))
    p = svc.prepare("q", [], None)
    cancelled = threading.Event()
    out = list(svc.stream(p, cancelled))
    assert [e.event for e in out] == ["meta", "delta", "reset", "delta", "done"]
    assert out[0].data == {"standalone_question": "q", "rewrite_fallback": False}
    assert out[1].data == {"text": "Fin"} and out[2].data == {"reason": "citation_retry"}
    assert out[-1].data == answer_payload(ANSWER, "q")
    assert rag.stream_cancelled == [cancelled]


@pytest.mark.parametrize("exc,code", [
    (RAGGenerationError("x"), "rag_generation_failed"),
    (InvalidLLMOutput("x"), "rag_generation_failed"),
    (LLMProviderError("x"), "llm_unavailable"),
    (RuntimeError("x"), "internal_error"),
])
def test_stream_errors_become_final_error_event(exc, code, caplog):
    svc, _, _ = make(rag=FakeRAG(FakeLLM(), [GenerationDelta("a")], error=exc))
    p = svc.prepare("q", [], None)
    with caplog.at_level(logging.ERROR, logger="shopmind.chat"):
        out = list(svc.stream(p, threading.Event()))
    assert [e.event for e in out] == ["meta", "delta", "error"]
    assert out[-1].data["code"] == code
    if code == "internal_error":
        assert out[-1].data["message"] == "chat generation failed"
        assert any(r.name == "shopmind.chat" and r.exc_info for r in caplog.records)
    else:
        assert not caplog.records


def test_abstain_streams_done_without_delta():
    abstain = RAGAnswer("Insufficient evidence.", (), True)
    svc, _, _ = make(rag=FakeRAG(FakeLLM(), [GenerationFinal(abstain)]))
    out = list(svc.stream(svc.prepare("q", [], None), threading.Event()))
    assert [e.event for e in out] == ["meta", "done"]
    assert out[-1].data["insufficient_evidence"] is True and out[-1].data["sources"] == []


def test_cancelled_stream_returns_silently_without_done_or_error():
    cancelled = threading.Event()

    class CancellingRAG(FakeRAG):
        def generate_stream(self, request, prepared, cancelled=None):
            yield GenerationDelta("a")
            cancelled.set()

    svc, _, _ = make(rag=CancellingRAG(FakeLLM()))
    out = list(svc.stream(svc.prepare("q", [], None), cancelled))
    assert [e.event for e in out] == ["meta", "delta"]


def test_stream_ending_without_final_and_not_cancelled_is_an_error():
    svc, _, _ = make(rag=FakeRAG(FakeLLM(), [GenerationDelta("a")]))
    out = list(svc.stream(svc.prepare("q", [], None), threading.Event()))
    assert [e.event for e in out] == ["meta", "delta", "error"]
    assert out[-1].data["code"] == "rag_generation_failed"


def streamed_logs(caplog):
    return [payload for record in caplog.records if record.name == "shopmind.chat" and record.levelno == logging.INFO
            and (payload := json.loads(record.getMessage())).get("event") == "chat_streamed"]


def test_stream_done_logs_one_chat_streamed_event_without_text(caplog):
    answer = RAGAnswer("zz-answer-text", ANSWER.sources, False, {"generation_attempts": 2, "total_ms": 12.5})
    svc, _, _ = make(rag=FakeRAG(FakeLLM(), [GenerationDelta("zz-answer-text"), GenerationFinal(answer)]))
    caplog.set_level(logging.DEBUG, logger="shopmind.chat")
    out = list(svc.stream(svc.prepare("zz-question-text", [], None), threading.Event()))
    assert out[-1].event == "done"
    assert streamed_logs(caplog) == [{"event": "chat_streamed", "outcome": "done", "generation_attempts": 2, "total_ms": 12.5, "error_type": None}]
    assert "zz-answer-text" not in caplog.text and "zz-question-text" not in caplog.text


@pytest.mark.parametrize("exc,code", [
    (RAGGenerationError("zz-secret"), "rag_generation_failed"),
    (InvalidLLMOutput("zz-secret"), "rag_generation_failed"),
    (LLMProviderError("zz-secret"), "llm_unavailable"),
])
def test_stream_generation_failure_logs_warning_and_outcome_by_type_only(exc, code, caplog):
    svc, _, _ = make(rag=FakeRAG(FakeLLM(), [GenerationDelta("a")], error=exc))
    caplog.set_level(logging.DEBUG, logger="shopmind.chat")
    out = list(svc.stream(svc.prepare("q", [], None), threading.Event()))
    assert out[-1].data["code"] == code
    warnings = [r for r in caplog.records if r.levelno == logging.WARNING]
    assert len(warnings) == 1 and type(exc).__name__ in warnings[0].getMessage() and not warnings[0].exc_info
    assert streamed_logs(caplog) == [{"event": "chat_streamed", "outcome": code, "generation_attempts": None, "total_ms": None, "error_type": type(exc).__name__}]
    assert "zz-secret" not in caplog.text


def test_stream_internal_error_logs_outcome_with_exception_type(caplog):
    svc, _, _ = make(rag=FakeRAG(FakeLLM(), [], error=RuntimeError("x")))
    caplog.set_level(logging.DEBUG, logger="shopmind.chat")
    out = list(svc.stream(svc.prepare("q", [], None), threading.Event()))
    assert [e.event for e in out] == ["meta", "error"] and out[-1].data["code"] == "internal_error"
    assert streamed_logs(caplog) == [{"event": "chat_streamed", "outcome": "internal_error", "generation_attempts": None, "total_ms": None, "error_type": "RuntimeError"}]


def test_stream_cancelled_by_flag_logs_cancelled_outcome(caplog):
    cancelled = threading.Event()

    class CancellingRAG(FakeRAG):
        def generate_stream(self, request, prepared, cancelled=None):
            yield GenerationDelta("a")
            cancelled.set()

    svc, _, _ = make(rag=CancellingRAG(FakeLLM()))
    caplog.set_level(logging.DEBUG, logger="shopmind.chat")
    list(svc.stream(svc.prepare("q", [], None), cancelled))
    assert streamed_logs(caplog) == [{"event": "chat_streamed", "outcome": "cancelled", "generation_attempts": None, "total_ms": None, "error_type": None}]
    assert [r for r in caplog.records if r.levelno >= logging.WARNING] == []


def test_stream_closed_by_consumer_logs_cancelled_outcome_once(caplog):
    svc, _, _ = make(rag=FakeRAG(FakeLLM(), [GenerationDelta("a"), GenerationDelta("b"), GenerationFinal(ANSWER)]))
    caplog.set_level(logging.DEBUG, logger="shopmind.chat")
    gen = svc.stream(svc.prepare("q", [], None), threading.Event())
    assert [next(gen).event, next(gen).event] == ["meta", "delta"]
    gen.close()
    gen.close()
    assert [log["outcome"] for log in streamed_logs(caplog)] == ["cancelled"]
    assert [r for r in caplog.records if r.levelno >= logging.WARNING] == []


@pytest.mark.parametrize("throw_after", [1, 2, 3])  # at meta, at delta, at done
def test_exception_thrown_in_at_a_yield_becomes_internal_error(throw_after, caplog):
    svc, _, _ = make(rag=FakeRAG(FakeLLM(), [GenerationDelta("a"), GenerationFinal(ANSWER)]))
    caplog.set_level(logging.DEBUG, logger="shopmind.chat")
    gen = svc.stream(svc.prepare("q", [], None), threading.Event())
    for _ in range(throw_after):
        next(gen)
    item = gen.throw(TypeError("not serializable"))
    assert (item.event, item.data["code"]) == ("error", "internal_error")
    gen.close()
    assert [(log["outcome"], log["error_type"]) for log in streamed_logs(caplog)] == [("internal_error", "TypeError")]
