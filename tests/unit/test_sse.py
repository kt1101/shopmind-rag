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
