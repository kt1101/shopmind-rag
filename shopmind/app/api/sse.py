from __future__ import annotations

import json
import threading
from collections.abc import AsyncIterator, Iterator
from typing import Any

from starlette.concurrency import run_in_threadpool
from starlette.responses import StreamingResponse
from starlette.types import Receive, Scope, Send

from shopmind.app.chat.models import ChatEvent


def format_sse(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False, separators=(',', ':'))}\n\n"


async def sse_stream(events: Iterator[ChatEvent], cancelled: threading.Event) -> AsyncIterator[str]:
    """Bridge a blocking event iterator to an async SSE body.

    On exit (completion, error, or client disconnect) only the cancel flag is
    set. The iterator is never closed from here: a worker thread may still be
    executing ``next()`` on it. The provider loop observes the flag at its next
    stream event and closes the upstream stream itself.
    """
    try:
        while True:
            item = await run_in_threadpool(next, events, None)
            if item is None:
                break
            yield format_sse(item.event, item.data)
    finally:
        cancelled.set()


class SSEResponse(StreamingResponse):
    """Event-stream response that always sets ``cancelled`` once the response ends.

    When Starlette cancels the body task on client disconnect, the async
    generator may stay suspended at a ``yield`` until it is garbage collected, so
    its ``finally`` is not guaranteed to run promptly. Setting the flag here makes
    the cancellation signal deterministic.
    """

    def __init__(self, events: Iterator[ChatEvent], cancelled: threading.Event) -> None:
        super().__init__(sse_stream(events, cancelled), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
        self._cancelled = cancelled

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        try:
            await super().__call__(scope, receive, send)
        finally:
            self._cancelled.set()
