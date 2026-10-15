from __future__ import annotations

import threading

import pytest

from shopmind.app.api.sse import format_sse, sse_stream
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
