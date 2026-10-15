import json
import threading
from types import SimpleNamespace

import pytest

from shopmind.app.llm.base import InvalidLLMOutput, LLMProviderError, LLMRequest, LLMResponse
from shopmind.app.llm.openai_provider import OpenAIProvider

ANSWER_JSON = json.dumps({"answer": "Blue.", "citation_ids": ["product:P1"], "insufficient_evidence": False})


class FakeStream:
    def __init__(self, events, fail_after=None):
        self.events = list(events)
        self.total_events = len(self.events)
        self.events_consumed = 0
        self.closed = False
        self.fail_after = fail_after

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()
        return False

    def close(self):
        self.closed = True

    def __iter__(self):
        for event in self.events:
            if self.fail_after is not None and self.events_consumed >= self.fail_after:
                raise ConnectionError("boom")
            self.events_consumed += 1
            yield event


def delta(text):
    return SimpleNamespace(type="response.output_text.delta", delta=text)


def completed(output_text=ANSWER_JSON):
    return SimpleNamespace(type="response.completed", response=SimpleNamespace(output_text=output_text, model="test-model", id="r1"))


def happy_events():
    return [delta('{"answer": "Bl'), delta('ue.", "citation_ids": ["product:P1"], '), delta('"insufficient_evidence": false}'), completed()]


class Responses:
    def __init__(self, result=None, error=None):
        self.result = result
        self.error = error
        self.kwargs = None

    def create(self, **kwargs):
        self.kwargs = kwargs
        if self.error:
            raise self.error
        return self.result


def make_provider(result=None, error=None):
    responses = Responses(result, error)
    return OpenAIProvider(client=SimpleNamespace(responses=responses), model="test-model"), responses


REQUEST = LLMRequest("Color?", '{"id":"product:P1"}', ("product:P1",), "Use evidence only")


def test_generate_stream_yields_deltas_then_parsed_response():
    stream = FakeStream(happy_events())
    provider, responses = make_provider(stream)

    items = list(provider.generate_stream(REQUEST))

    assert "".join(i for i in items if isinstance(i, str)) == "Blue."
    assert isinstance(items[-1], LLMResponse) and items[-1].citation_ids == ("product:P1",)
    assert sum(isinstance(i, LLMResponse) for i in items) == 1
    assert items[-1].metadata == {"provider": "openai", "model": "test-model", "response_id": "r1"}
    kw = responses.kwargs
    assert kw["stream"] is True and kw["store"] is False and kw["text"]["format"]["schema"]["required"][0] == "answer"
    assert stream.closed


def test_cancel_stops_consuming_and_closes_stream():
    stream = FakeStream(happy_events())
    provider, _ = make_provider(stream)
    cancelled = threading.Event()
    gen = provider.generate_stream(REQUEST, cancelled)

    next(gen)
    cancelled.set()

    assert list(gen) == []
    assert stream.closed and stream.events_consumed < stream.total_events


def test_closing_generator_closes_stream():
    stream = FakeStream(happy_events())
    provider, _ = make_provider(stream)
    gen = provider.generate_stream(REQUEST)

    next(gen)
    gen.close()

    assert stream.closed


@pytest.mark.parametrize(
    "event,error",
    [
        (SimpleNamespace(type="response.failed", response=SimpleNamespace(error=None)), LLMProviderError),
        (SimpleNamespace(type="error", message="x", code="server_error"), LLMProviderError),
        (SimpleNamespace(type="response.incomplete", response=SimpleNamespace(incomplete_details=None)), InvalidLLMOutput),
        (SimpleNamespace(type="response.refusal.delta", delta="no"), InvalidLLMOutput),
    ],
)
def test_terminal_events_map_to_errors(event, error):
    stream = FakeStream([delta('{"answer": "Hi'), event, completed()])
    provider, _ = make_provider(stream)

    with pytest.raises(error):
        list(provider.generate_stream(REQUEST))

    assert stream.closed


def test_create_exception_and_missing_completed_raise_provider_error():
    provider, _ = make_provider(error=RuntimeError("down"))
    with pytest.raises(LLMProviderError):
        list(provider.generate_stream(REQUEST))

    stream = FakeStream([delta('{"answer": "Hi')])
    provider, _ = make_provider(stream)
    with pytest.raises(LLMProviderError):
        list(provider.generate_stream(REQUEST))
    assert stream.closed


def test_iteration_exception_raises_provider_error():
    stream = FakeStream(happy_events(), fail_after=1)
    provider, _ = make_provider(stream)

    with pytest.raises(LLMProviderError):
        list(provider.generate_stream(REQUEST))

    assert stream.closed


def test_invalid_completed_output_raises_invalid_output():
    stream = FakeStream([delta("{}"), completed('{"answer":"Blue.","citation_ids":[7],"insufficient_evidence":false}')])
    provider, _ = make_provider(stream)

    with pytest.raises(InvalidLLMOutput):
        list(provider.generate_stream(REQUEST))


def test_rewrite_question_includes_viewed_product_and_history():
    provider, responses = make_provider(SimpleNamespace(output_text=json.dumps({"question": " Is the Klepe Navy Runner waterproof? "})))

    q = provider.rewrite_question([("user", "Tell me about P1 shoes"), ("assistant", "...")], "Is it waterproof?", product=("P2", "Klepe Navy Runner"))

    kw = responses.kwargs
    sent = str(kw["input"])
    assert "P2" in sent and "Klepe Navy Runner" in sent and "Is it waterproof?" in sent and "Tell me about P1 shoes" in sent
    assert kw["store"] is False and not kw.get("stream")
    assert kw["text"]["format"]["schema"]["required"] == ["question"] and kw["text"]["format"]["strict"] is True
    assert q == "Is the Klepe Navy Runner waterproof?"


def test_rewrite_question_without_product_omits_viewed_product():
    provider, responses = make_provider(SimpleNamespace(output_text=json.dumps({"question": "Q?"})))

    provider.rewrite_question([], "Q?")

    assert "viewed" not in str(responses.kwargs["input"][1]["content"]).lower()


@pytest.mark.parametrize("question", ["   ", "x" * 501])
def test_rewrite_question_blank_or_over_500_chars_raises_invalid_output(question):
    provider, _ = make_provider(SimpleNamespace(output_text=json.dumps({"question": question})))

    with pytest.raises(InvalidLLMOutput):
        provider.rewrite_question([], "Q?")


def test_rewrite_question_malformed_output_raises_invalid_output():
    provider, _ = make_provider(SimpleNamespace(output_text="not json"))
    with pytest.raises(InvalidLLMOutput):
        provider.rewrite_question([], "Q?")


def test_rewrite_question_create_exception_raises_provider_error():
    provider, _ = make_provider(error=RuntimeError("down"))
    with pytest.raises(LLMProviderError):
        provider.rewrite_question([], "Q?")
