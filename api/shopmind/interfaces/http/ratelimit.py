"""Per-client-IP rate limiting for costly public endpoints (``/rag/*``, ``/chat/*``).

Usage: ``@router.post("/rag/ask", dependencies=[Depends(rate_limit)])``. The limit is
``features.rate_limit_per_minute`` from the effective config (0 disables it). In-memory sliding
window per process (one minute), so it is a cost guard for demos, not a security boundary.
Exceeding it answers ``429 {"error": {"code": "rate_limited"}}``.
"""
from __future__ import annotations

import threading
import time
from collections import deque

from fastapi import Request

from shopmind.interfaces.http.errors import register_error

WINDOW_SECONDS = 60.0
MAX_TRACKED_CLIENTS = 10000


class RateLimited(Exception):
    """Too many requests from one client in the current window."""


register_error(RateLimited, 429, "rate_limited")


class SlidingWindowLimiter:
    def __init__(self, window_seconds: float = WINDOW_SECONDS, max_clients: int = MAX_TRACKED_CLIENTS) -> None:
        self.window = window_seconds
        self.max_clients = max_clients
        self._hits: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def hit(self, key: str, limit: int, now: float | None = None) -> tuple[bool, float]:
        """Record one request; returns ``(allowed, retry_after_seconds)``. Rejected requests are not counted."""
        if limit <= 0:
            return True, 0.0
        now = time.monotonic() if now is None else now
        cutoff = now - self.window
        with self._lock:
            hits = self._hits.get(key)
            if hits is None:
                if len(self._hits) >= self.max_clients:
                    self._evict(cutoff)
                hits = self._hits.setdefault(key, deque())
            while hits and hits[0] <= cutoff:
                hits.popleft()
            if len(hits) >= limit:
                return False, max(0.0, hits[0] + self.window - now)
            hits.append(now)
            return True, 0.0

    def _evict(self, cutoff: float) -> None:
        for key in [key for key, hits in self._hits.items() if not hits or hits[-1] <= cutoff]:
            del self._hits[key]
        while len(self._hits) >= self.max_clients:
            del self._hits[next(iter(self._hits))]

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


def client_key(request: Request) -> str:
    return request.client.host if request.client is not None else "unknown"


def _limiter(request: Request) -> SlidingWindowLimiter:
    state = request.app.state
    limiter = getattr(state, "rate_limiter", None)
    if limiter is None:
        limiter = SlidingWindowLimiter()
        state.rate_limiter = limiter
    return limiter


def _limit(request: Request) -> int:
    from shopmind.interfaces.http.deps import get_config

    try:
        config = get_config(request)
    except Exception:
        config = getattr(request.app.state, "config", None)
    return int(config.features.rate_limit_per_minute) if config is not None else 0


def rate_limit(request: Request) -> None:
    """FastAPI dependency: raise ``RateLimited`` (429) when the client exceeded its budget."""
    limit = _limit(request)
    if limit <= 0:
        return
    allowed, retry_after = _limiter(request).hit(client_key(request), limit)
    if not allowed:
        raise RateLimited(f"rate limit of {limit} requests per minute exceeded, retry in {int(retry_after) + 1}s")
