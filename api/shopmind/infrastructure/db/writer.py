"""Fire-and-forget database writes off the request path.

Request handlers (search, chat, tracing) must never wait on the database or fail because it is
down. ``BackgroundWriter.submit(fn)`` queues ``fn(session)``; one daemon thread runs the queue
in order, each item in its own transaction. A full queue or an open circuit breaker drops the
write (logged, rate-limited). ``flush()`` waits for pending writes (tests, read-after-write).
"""
from __future__ import annotations

import logging
import queue
import threading
import time
from collections.abc import Callable
from typing import Any

from sqlalchemy.orm import Session

from shopmind.infrastructure.db.engine import Database

logger = logging.getLogger("shopmind.db.writer")

Write = Callable[[Session], Any]


class BackgroundWriter:
    def __init__(self, db: Database, *, max_queue: int = 10000, name: str = "shopmind-db-writer") -> None:
        self.db = db
        self._queue: queue.Queue[Write | None] = queue.Queue(maxsize=max_queue)
        self._pending = 0
        self._cond = threading.Condition()
        self._name = name
        self._thread: threading.Thread | None = None
        self._start_lock = threading.Lock()
        self._last_warning = 0.0
        self.dropped = 0

    def _ensure_thread(self) -> None:
        if self._thread is not None and self._thread.is_alive():
            return
        with self._start_lock:
            if self._thread is None or not self._thread.is_alive():
                self._thread = threading.Thread(target=self._run, name=self._name, daemon=True)
                self._thread.start()

    def _warn(self, message: str, *args: Any) -> None:
        now = time.monotonic()
        if now - self._last_warning > 30:
            self._last_warning = now
            logger.warning(message, *args)

    def submit(self, write: Write) -> bool:
        if not self.db.available:
            self.dropped += 1
            self._warn("database unavailable, dropping writes")
            return False
        with self._cond:
            self._pending += 1
        try:
            self._queue.put_nowait(write)
        except queue.Full:
            with self._cond:
                self._pending -= 1
                self._cond.notify_all()
            self.dropped += 1
            self._warn("database write queue full, dropping writes")
            return False
        self._ensure_thread()
        return True

    def flush(self, timeout: float = 5.0) -> bool:
        deadline = time.monotonic() + timeout
        with self._cond:
            while self._pending > 0:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return False
                self._cond.wait(remaining)
        return True

    def _run(self) -> None:
        while True:
            write = self._queue.get()
            if write is None:
                return
            try:
                if self.db.available:
                    with self.db.session() as session:
                        write(session)
                else:
                    self.dropped += 1
            except Exception as exc:
                self.dropped += 1
                self._warn("background database write failed: %s", exc)
            finally:
                with self._cond:
                    self._pending -= 1
                    self._cond.notify_all()
