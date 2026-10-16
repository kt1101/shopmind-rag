"""Trace store (memory by default; ``tracing.store: database`` once the DB adapter registers it)."""
from __future__ import annotations

from shopmind.core.registry import create

ORDER = 5
CRITICAL = False
LIGHTWEIGHT = True


def wire(container) -> None:
    if container.get("trace_store") is not None:
        return
    import shopmind.core.trace_store  # noqa: F401  (registers "memory")

    tracing = container.config.tracing
    container.provide("trace_store", create("trace_store", tracing.store, capacity=tracing.memory_capacity, container=container))
