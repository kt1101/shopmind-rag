"""Trace persistence port + in-memory default (a DB-backed store registers as ``database``)."""
from __future__ import annotations

import threading
from collections import OrderedDict
from typing import Any, Protocol

from shopmind.core.registry import register


class TraceStore(Protocol):
    def save(self, trace: dict[str, Any]) -> None: ...
    def get(self, trace_id: str) -> dict[str, Any] | None: ...
    def list(self, *, q: str | None = None, kind: str | None = None, limit: int = 50, offset: int = 0) -> tuple[int, list[dict[str, Any]]]: ...


@register("trace_store", "memory")
class InMemoryTraceStore:
    def __init__(self, capacity: int = 500, **_: Any) -> None:
        self.capacity = capacity
        self._items: OrderedDict[str, dict[str, Any]] = OrderedDict()
        self._lock = threading.Lock()

    def save(self, trace: dict[str, Any]) -> None:
        with self._lock:
            self._items[trace["trace_id"]] = trace
            self._items.move_to_end(trace["trace_id"])
            while len(self._items) > self.capacity:
                self._items.popitem(last=False)

    def get(self, trace_id: str) -> dict[str, Any] | None:
        with self._lock:
            return self._items.get(trace_id)

    def list(self, *, q: str | None = None, kind: str | None = None, limit: int = 50, offset: int = 0) -> tuple[int, list[dict[str, Any]]]:
        with self._lock:
            items = list(reversed(self._items.values()))
        if kind:
            items = [item for item in items if item.get("kind") == kind]
        if q:
            needle = q.casefold()
            items = [item for item in items if needle in str(item.get("input", "")).casefold() or needle in item["trace_id"]]
        return len(items), items[offset: offset + limit]
