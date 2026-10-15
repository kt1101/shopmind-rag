from __future__ import annotations

import threading

import pytest

from shopmind.app.domain.search_result import RetrievedDocument
from shopmind.app.llm.base import InvalidLLMOutput, LLMResponse
from shopmind.app.rag.models import GenerationDelta, GenerationFinal, GenerationReset, PreparedContext, RAGRequest
from shopmind.app.rag.service import RAGGenerationError
from tests.a3.test_a3_service import Retriever, _service


class StreamingLLM:
    """Scripted per attempt: each script is a list of str deltas, LLMResponse finals, or exceptions to raise."""

    def __init__(self, scripts):
        self.scripts = iter(scripts)
        self.requests = []
        self.cancelled_args = []

    def generate(self, request):
        raise AssertionError("streaming path must not call generate")

    def generate_stream(self, request, cancelled=None):
        self.requests.append(request)
        self.cancelled_args.append(cancelled)
        for item in next(self.scripts):
            if isinstance(item, Exception):
                raise item
            yield item


class BlockingLLM(StreamingLLM):
    def generate(self, request):
        self.requests.append(request)
        return next(self.scripts)[0]


def _product():
    return RetrievedDocument("product:P1", "Blue shoes", 1.0, "product", {"title": "Blue shoes", "product_id": "P1"})


def _request():
    return RAGRequest("What color?", product_id="P1", sources=("product",))


def _service_with(scripts, documents=None):
    llm = StreamingLLM(scripts)
    documents = [_product()] if documents is None else documents
    return _service({"product": Retriever("product", documents)}, llm), llm


def test_generate_stream_emits_deltas_then_final_with_resolved_sources():
    service, llm = _service_with([["Available ", "in blue.", LLMResponse("Available in blue.", ("product:P1",), False, {"model": "m"})]])
    request = _request()

    events = list(service.generate_stream(request, service.prepare(request)))

    assert [type(event).__name__ for event in events] == ["GenerationDelta", "GenerationDelta", "GenerationFinal"]
    assert [event.text for event in events[:2]] == ["Available ", "in blue."]
    final = events[-1].answer
    assert final.answer == "Available in blue."
    assert [(source.document_id, source.source, source.product_id) for source in final.sources] == [("product:P1", "product", "P1")]
    assert final.insufficient_evidence is False
    assert final.metadata["generation_attempts"] == 1
    assert final.metadata["model"] == "m"
    assert final.metadata["total_ms"] >= 0
    assert final.metadata["context_ids"] == ["product:P1"]
    assert llm.requests[0].allowed_citation_ids == ("product:P1",)


def test_invalid_citations_emit_reset_then_retry_stream():
    service, llm = _service_with([
        ["Available in blue.", LLMResponse("Available in blue.", ("product:made-up",), False)],
        ["Blue.", LLMResponse("Blue.", ("product:P1",), False)],
    ])
    request = _request()

    events = list(service.generate_stream(request, service.prepare(request)))

    assert [type(event).__name__ for event in events] == ["GenerationDelta", "GenerationReset", "GenerationDelta", "GenerationFinal"]
    assert events[1].reason == "citation_retry"
    assert "rejected" in llm.requests[1].instructions
    assert "rejected" not in llm.requests[0].instructions
    assert events[-1].answer.metadata["generation_attempts"] == 2
    assert [source.document_id for source in events[-1].answer.sources] == ["product:P1"]


def test_failed_attempt_without_deltas_emits_no_reset():
    service, llm = _service_with([
        [InvalidLLMOutput("bad json")],
        ["Blue.", LLMResponse("Blue.", ("product:P1",), False)],
    ])
    request = _request()

    events = list(service.generate_stream(request, service.prepare(request)))

    assert [type(event).__name__ for event in events] == ["GenerationDelta", "GenerationFinal"]
    assert "bad json" in llm.requests[1].instructions


def test_two_invalid_attempts_raise_generation_error():
    service, llm = _service_with([
        ["Blue.", LLMResponse("Blue.", ("product:fake",), False)],
        ["Blue.", LLMResponse("Blue.", ("product:fake",), False)],
    ])
    request = _request()
    seen = []

    with pytest.raises(RAGGenerationError):
        for event in service.generate_stream(request, service.prepare(request)):
            seen.append(type(event).__name__)

    # No reset after the last failed attempt: the caller sees the error instead.
    assert seen == ["GenerationDelta", "GenerationReset", "GenerationDelta"]
    assert len(llm.requests) == 2


def test_empty_context_yields_abstain_final_without_llm_call():
    service, llm = _service_with([], documents=[])
    request = _request()

    events = list(service.generate_stream(request, service.prepare(request)))

    assert [type(event).__name__ for event in events] == ["GenerationFinal"]
    answer = events[0].answer
    assert answer.insufficient_evidence is True
    assert answer.sources == ()
    assert answer.metadata["generation_attempts"] == 0
    assert answer.metadata["missing_sources"] == ["product"]
    assert llm.requests == []


def test_cancel_flag_is_passed_to_llm():
    service, llm = _service_with([["Blue."], ["Blue."]])
    request = _request()
    prepared = service.prepare(request)
    flag = threading.Event()

    list(service.generate_stream(request, prepared, flag))
    assert llm.cancelled_args[-1] is flag


def test_cancelled_stream_ends_without_final_or_retry():
    service, llm = _service_with([["Blue."]])
    request = _request()

    events = list(service.generate_stream(request, service.prepare(request), threading.Event()))

    assert [type(event).__name__ for event in events] == ["GenerationDelta"]
    assert len(llm.requests) == 1


def test_answer_equals_generate_of_prepare():
    request = _request()
    response = LLMResponse("Available in blue.", ("product:P1",), False)
    service, _ = _service_with([])
    service.llm = BlockingLLM([[response], [response]])

    answered = service.answer(request)
    generated = service.generate(request, service.prepare(request))

    assert isinstance(service.prepare(request), PreparedContext)
    for answer in (answered, generated):
        assert answer.answer == "Available in blue."
        assert [source.document_id for source in answer.sources] == ["product:P1"]
        assert answer.insufficient_evidence is False
        assert answer.metadata["generation_attempts"] == 1
        assert answer.metadata["total_ms"] >= 0
    assert answered.sources == generated.sources


def test_generation_event_models_are_frozen_with_defaults():
    assert GenerationReset().reason == "citation_retry"
    with pytest.raises(AttributeError):
        GenerationDelta("x").text = "y"
    assert GenerationFinal.__dataclass_params__.frozen
