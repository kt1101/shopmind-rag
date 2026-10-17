"""Glass-box pipeline tracing (schema: docs/API_CONTRACT.md "Trace schema").

A ``PipelineTrace`` is bound to the current request through a context variable, so any layer
can add a step without threading a tracer argument through every call:

    with start_trace("search.hybrid", kind="search", input={...}) as trace:
        with trace_step("retrieve", impl="bm25", id="lexical", params={...}) as step:
            hits = bm25.search(...)
            step.set_items(hits_to_items(hits), total=len(hits))
            step.note("alias 'giày bốt' -> category 'boot'")

Outside an active trace, ``trace_step`` yields a no-op step, so instrumented code costs nothing
when explain/tracing is off. Vectors and image bytes are stripped by ``sanitize``.
"""
from __future__ import annotations

import contextvars
import math
from collections.abc import Iterator, Mapping, Sequence
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime
from time import perf_counter
from typing import Any

_BANNED_KEY_PARTS = ("vector", "embedding", "image_bytes", "raw_image", "api_key", "password", "secret", "authorization")
# A vector-named key is kept only when it is a summary like {"dims": [768], "norm": 1.0}.
_VECTOR_SUMMARY_KEYS = {"dims", "norm", "hash", "model", "embedder"}
DEFAULT_MAX_ITEMS = 20

_current: contextvars.ContextVar[PipelineTrace | None] = contextvars.ContextVar("shopmind_trace", default=None)


def sanitize(value: Any, *, depth: int = 0) -> Any:
    """Make a value JSON-safe and drop anything that looks like a vector, bytes or a secret."""
    if depth > 8:
        return "…"
    if value is None or isinstance(value, (bool, int, str)):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, (bytes, bytearray, memoryview)):
        return f"<{len(value)} bytes>"
    if isinstance(value, Mapping):
        out = {}
        for key, item in value.items():
            name = str(key)
            if any(part in name.lower() for part in _BANNED_KEY_PARTS):
                if not (isinstance(item, Mapping) and item and set(map(str, item)) <= _VECTOR_SUMMARY_KEYS and "secret" not in name.lower() and "password" not in name.lower() and "key" not in name.lower()):
                    continue
            out[name] = sanitize(item, depth=depth + 1)
        return out
    if hasattr(value, "shape") and hasattr(value, "dtype"):  # numpy / torch arrays
        return {"dims": list(getattr(value, "shape", ()))}
    if isinstance(value, Sequence) and not isinstance(value, str):
        if len(value) > 64 and all(isinstance(item, float) for item in value[:64]):
            return {"dims": [len(value)]}
        return [sanitize(item, depth=depth + 1) for item in value]
    if hasattr(value, "value") and isinstance(getattr(value, "value"), str):  # enums
        return value.value
    return str(value)


@dataclass
class StepTrace:
    step: str
    impl: str | None = None
    id: str | None = None
    params: dict[str, Any] = field(default_factory=dict)
    started_ms: float = 0.0
    duration_ms: float = 0.0
    summary: str | None = None
    notes: list[str] = field(default_factory=list)
    output: dict[str, Any] = field(default_factory=dict)
    details: dict[str, Any] = field(default_factory=dict)
    status: str = "ok"
    error: str | None = None
    max_items: int = DEFAULT_MAX_ITEMS
    # True when the request asked for ``explain``: steps may then do extra, costlier work
    # (ES highlight, filter resolution details) purely for the inspector.
    verbose: bool = False

    @property
    def active(self) -> bool:
        return True

    def note(self, text: str) -> None:
        self.notes.append(text)

    def set_summary(self, text: str) -> None:
        self.summary = text

    def set_items(self, items: Sequence[Mapping[str, Any]], *, total: int | None = None) -> None:
        self.output["items"] = [sanitize(item) for item in list(items)[: self.max_items]]
        self.output["total"] = len(items) if total is None else total

    def set_output(self, **values: Any) -> None:
        self.output.update(sanitize(values))

    def set_details(self, **values: Any) -> None:
        self.details.update(sanitize(values))

    def to_dict(self) -> dict[str, Any]:
        data = {
            "id": self.id or self.step, "step": self.step, "impl": self.impl, "params": sanitize(self.params),
            "started_ms": round(self.started_ms, 3), "duration_ms": round(self.duration_ms, 3),
            "summary": self.summary, "notes": list(self.notes), "output": self.output, "status": self.status,
        }
        if self.details:
            data["details"] = self.details
        if self.error:
            data["error"] = self.error
        return data


class _NullStep(StepTrace):
    """Returned when no trace is active: every mutator is a cheap no-op."""

    def note(self, text: str) -> None: ...
    def set_summary(self, text: str) -> None: ...
    def set_items(self, items, *, total=None) -> None: ...
    def set_output(self, **values: Any) -> None: ...
    def set_details(self, **values: Any) -> None: ...

    @property
    def active(self) -> bool:
        return False


@dataclass
class PipelineTrace:
    trace_id: str
    pipeline: str
    kind: str
    input: dict[str, Any] = field(default_factory=dict)
    steps: list[StepTrace] = field(default_factory=list)
    output: dict[str, Any] = field(default_factory=dict)
    created_at: str = field(default_factory=lambda: datetime.now(UTC).isoformat().replace("+00:00", "Z"))
    duration_ms: float = 0.0
    max_items: int = DEFAULT_MAX_ITEMS
    verbose: bool = False
    _started: float = field(default_factory=perf_counter, repr=False)

    def elapsed_ms(self) -> float:
        return (perf_counter() - self._started) * 1000

    def set_output(self, **values: Any) -> None:
        self.output.update(sanitize(values))

    def finish(self) -> None:
        self.duration_ms = self.elapsed_ms()

    def to_dict(self) -> dict[str, Any]:
        return {
            "trace_id": self.trace_id, "pipeline": self.pipeline, "kind": self.kind, "created_at": self.created_at,
            "duration_ms": round(self.duration_ms or self.elapsed_ms(), 3), "input": sanitize(self.input),
            "steps": [step.to_dict() for step in self.steps], "output": self.output,
        }


def current_trace() -> PipelineTrace | None:
    return _current.get()


@contextmanager
def start_trace(pipeline: str, *, kind: str, trace_id: str, input: Mapping[str, Any] | None = None, max_items: int = DEFAULT_MAX_ITEMS, verbose: bool = False) -> Iterator[PipelineTrace]:
    """Bind a new trace for the duration of the block (nested calls reuse the outer trace)."""
    outer = _current.get()
    if outer is not None:
        yield outer
        return
    trace = PipelineTrace(trace_id=trace_id, pipeline=pipeline, kind=kind, input=dict(input or {}), max_items=max_items, verbose=verbose)
    token = _current.set(trace)
    try:
        yield trace
    finally:
        trace.finish()
        _current.reset(token)


@contextmanager
def trace_step(step: str, *, impl: str | None = None, id: str | None = None, params: Mapping[str, Any] | None = None, trace: PipelineTrace | None = None) -> Iterator[StepTrace]:
    """Record one step in ``trace`` (default: the trace bound to the current context).

    Pass ``trace`` explicitly from code that runs outside the request context, such as a
    streaming generator advanced from worker threads."""
    trace = trace if trace is not None else _current.get()
    if trace is None:
        yield _NullStep(step)
        return
    record = StepTrace(step=step, impl=impl, id=id, params=dict(params or {}), started_ms=trace.elapsed_ms(), max_items=trace.max_items, verbose=trace.verbose)
    trace.steps.append(record)
    started = perf_counter()
    try:
        yield record
    except Exception as exc:
        record.status, record.error = "error", type(exc).__name__
        raise
    finally:
        record.duration_ms = (perf_counter() - started) * 1000


def result_items(results: Sequence[Any]) -> list[dict[str, Any]]:
    """Convert A1 ``SearchResult``-like objects into trace items."""
    items = []
    for result in results:
        metadata = getattr(result, "metadata", {}) or {}
        scores = getattr(result, "retrieval_scores", None)
        details = {key: value for key, value in (vars(scores).items() if scores is not None and hasattr(scores, "__dict__") else []) if value is not None}
        for key in ("matched_terms", "contributions", "formula", "ordering_policy", "explanation", "before_rank", "after_rank", "reranker_score", "boosted"):
            if key in metadata:
                details[key] = metadata[key]
        items.append({"id": getattr(result, "product_id", None) or getattr(result, "id", None), "rank": getattr(result, "rank", None), "score": getattr(result, "score", None), "title": getattr(result, "title", None) or metadata.get("title"), "details": details})
    return items
