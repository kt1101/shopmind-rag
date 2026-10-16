from __future__ import annotations

import logging
import threading

import pytest

from shopmind.app.api.sse import format_sse, release_stream, sse_stream
from shopmind.app.chat.models import ChatEvent


def test_format_sse_frames_json():
    assert format_sse("delta", {"text": "é"}) == 'event: delta\ndata: {"text":"é"}\n\n'


@pytest.mark.asyncio
async def test_sse_stream_yields_frames_in_order():
    cancelled = threading.Event()
    frames = [frame async for frame in sse_stream(iter([ChatEvent("meta", {}), ChatEvent("delta", {"text": "a"})]), cancelled)]
    assert frames == ["event: meta\ndata: {}\n\n", 'event: delta\ndata: {"text":"a"}\n\n']


@pytest.mark.asyncio
async def test_sse_stream_sets_cancel_on_early_close():
    cancelled = threading.Event()
    agen = sse_stream(iter([ChatEvent("meta", {}), ChatEvent("delta", {"text": "a"})]), cancelled)
    await agen.__anext__()
    assert not cancelled.is_set()
    await agen.aclose()
    assert cancelled.is_set()


@pytest.mark.asyncio
async def test_release_stream_closes_suspended_generator_and_sets_flag():
    closed = []

    def events():
        try:
            yield ChatEvent("meta", {})
            yield ChatEvent("delta", {"text": "a"})
        finally:
            closed.append(True)

    gen, cancelled = events(), threading.Event()
    next(gen)
    await release_stream(gen, cancelled)
    assert cancelled.is_set() and closed == [True]


@pytest.mark.asyncio
async def test_release_stream_on_exhausted_generator_logs_nothing(caplog):
    caplog.set_level(logging.DEBUG)
    gen, cancelled = iter([ChatEvent("meta", {})]), threading.Event()
    frames = [frame async for frame in sse_stream(gen, cancelled)]
    await release_stream(gen, cancelled)
    assert len(frames) == 1 and cancelled.is_set()
    assert caplog.records == []


@pytest.mark.asyncio
async def test_release_stream_close_failure_is_logged_by_type_only(caplog):
    class Broken:
        def close(self):
            raise ValueError("generator already executing secret-text")

    caplog.set_level(logging.DEBUG)
    cancelled = threading.Event()
    await release_stream(Broken(), cancelled)
    assert cancelled.is_set()
    assert [r.levelno for r in caplog.records] == [logging.WARNING]
    assert "ValueError" in caplog.text and "secret-text" not in caplog.text


INTERNAL_ERROR_FRAME = 'event: error\ndata: {"code":"internal_error","message":"chat generation failed"}\n\n'


@pytest.mark.asyncio
async def test_unserializable_event_becomes_final_internal_error_and_stops(caplog):
    caplog.set_level(logging.DEBUG)
    events = iter([ChatEvent("meta", {}), ChatEvent("delta", {"text": object()}), ChatEvent("delta", {"text": "after"})])
    cancelled = threading.Event()
    frames = [frame async for frame in sse_stream(events, cancelled)]
    assert frames == ["event: meta\ndata: {}\n\n", INTERNAL_ERROR_FRAME]
    assert cancelled.is_set()
    assert [r.levelno for r in caplog.records] == [logging.WARNING]
    assert "TypeError" in caplog.text and "object at" not in caplog.text


@pytest.mark.asyncio
async def test_unserializable_chat_service_event_is_recorded_as_internal_error(caplog):
    from shopmind.app.rag.models import Citation, GenerationDelta, GenerationFinal, RAGAnswer
    from tests.unit.test_chat_service import FakeLLM, FakeRAG, make, streamed_logs

    answer = RAGAnswer("Final text", (Citation("D1", "policy", "Returns", 0.5, metadata={"bad": object()}),), False, {"generation_attempts": 1, "total_ms": 3.0})
    svc, _, _ = make(rag=FakeRAG(FakeLLM(), [GenerationDelta("Final text"), GenerationFinal(answer)]))
    caplog.set_level(logging.DEBUG, logger="shopmind.chat")
    gen, cancelled = svc.stream(svc.prepare("q", [], None), threading.Event()), threading.Event()
    frames = [frame async for frame in sse_stream(gen, cancelled)]
    await release_stream(gen, cancelled)
    assert [frame.split("\n", 1)[0] for frame in frames] == ["event: meta", "event: delta", "event: error"]
    assert frames[-1] == INTERNAL_ERROR_FRAME
    assert [(log["outcome"], log["error_type"]) for log in streamed_logs(caplog)] == [("internal_error", "TypeError")]
