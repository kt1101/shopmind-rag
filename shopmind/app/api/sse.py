from __future__ import annotations

import json
import logging
import threading
from collections.abc import AsyncIterator, Iterator
from typing import Any

import anyio
from starlette.concurrency import run_in_threadpool
from starlette.responses import StreamingResponse
from starlette.types import Receive, Scope, Send

from shopmind.app.chat.models import ChatEvent

logger = logging.getLogger("shopmind.chat")


def format_sse(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False, separators=(',', ':'))}\n\n"


async def sse_stream(events: Iterator[ChatEvent], cancelled: threading.Event) -> AsyncIterator[str]:
    """Bridge a blocking event iterator to an async SSE body.

    On exit (completion, error, or client disconnect) only the cancel flag is
    set here; ``SSEResponse`` closes the iterator once the response has ended,
    because a worker thread may still be executing ``next()`` while this
    generator is being torn down.
    """
    try:
        while True:
            item = await run_in_threadpool(next, events, None)
            if item is None:
                break
            yield format_sse(item.event, item.data)
    finally:
        cancelled.set()


async def release_stream(events: Iterator[ChatEvent], cancelled: threading.Event) -> None:
    """Signal cancellation, then close the sync iterator so upstream streams unwind.

    Only call once the response has ended: ``run_in_threadpool`` does not abandon
    its worker on cancel, so no thread can still be inside ``next(events)`` here.
    Closing raises ``GeneratorExit`` at the suspended ``yield`` and unwinds the
    provider's ``with stream:`` block (closing the OpenAI stream). Closing an
    exhausted generator is a no-op. Failures are logged by type only.
    """
    cancelled.set()
    close = getattr(events, "close", None)
    if close is None:
        return
    try:
        with anyio.CancelScope(shield=True):
            await run_in_threadpool(close)
    except Exception as exc:
        logger.warning("chat stream close failed: %s", type(exc).__name__)


class SSEResponse(StreamingResponse):
    """Event-stream response that always cancels and closes its event source when it ends.

    When Starlette cancels the body task on client disconnect, the async generator
    may stay suspended at a ``yield`` until it is garbage collected, so its
    ``finally`` is not guaranteed to run promptly. Releasing here makes both the
    cancellation signal and the upstream close deterministic.
    """

    def __init__(self, events: Iterator[ChatEvent], cancelled: threading.Event) -> None:
        super().__init__(sse_stream(events, cancelled), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
        self._events = events
        self._cancelled = cancelled

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        try:
            await super().__call__(scope, receive, send)
        finally:
            await release_stream(self._events, self._cancelled)
