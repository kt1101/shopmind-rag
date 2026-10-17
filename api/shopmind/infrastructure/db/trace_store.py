"""Database-backed trace store (``tracing.store: database``), same interface as the memory store.

Saves go through the background writer (never block or fail a request); a small in-memory
cache serves ``get`` for traces whose write is still pending or when the database is down.
Rows older than ``tracing.retention_days`` are purged periodically and never returned.
"""
from __future__ import annotations

import logging
import time
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import delete, func, or_, select

from shopmind.core.registry import register
from shopmind.core.trace_store import InMemoryTraceStore
from shopmind.infrastructure.db.engine import Database, DatabaseUnavailable, as_utc
from shopmind.infrastructure.db.models import PipelineTraceRecord
from shopmind.infrastructure.db.writer import BackgroundWriter

logger = logging.getLogger("shopmind.db.traces")

PURGE_INTERVAL_SECONDS = 3600


def input_summary(trace: dict[str, Any]) -> str:
    """One-line description of a trace input for lists (``[image]`` for uploads)."""
    data = trace.get("input") or {}
    if not isinstance(data, dict):
        return str(data)[:200]
    text = data.get("query") or data.get("question") or data.get("message") or data.get("text")
    has_image = any(key in data for key in ("image", "image_token", "image_size", "image_name")) or trace.get("kind") in {"image_search"}
    if text and has_image:
        return f'[image] + "{str(text)[:180]}"'
    if text:
        return str(text)[:200]
    if has_image:
        return "[image upload]"
    if data.get("product_ids"):
        return "compare " + ", ".join(map(str, data["product_ids"]))[:190]
    return ""


def _parse_created(value: Any) -> datetime:
    if isinstance(value, str):
        try:
            return as_utc(datetime.fromisoformat(value.replace("Z", "+00:00"))) or datetime.now(UTC)
        except ValueError:
            pass
    return datetime.now(UTC)


@register("trace_store", "database")
class DatabaseTraceStore:
    def __init__(self, capacity: int = 500, container: Any = None, db: Database | None = None, writer: BackgroundWriter | None = None, retention_days: int | None = None, **_: Any) -> None:
        if db is None and container is not None:
            db = container.get("db")
            writer = writer or container.get("db_writer")
        if retention_days is None:
            retention_days = container.config.tracing.retention_days if container is not None else 7
        self.db = db
        self.writer = writer or (BackgroundWriter(db) if db is not None else None)
        self.retention = timedelta(days=retention_days)
        self.cache = InMemoryTraceStore(capacity=min(capacity, 200))
        self._last_purge = 0.0

    def _cutoff(self) -> datetime:
        return datetime.now(UTC) - self.retention

    def save(self, trace: dict[str, Any]) -> None:
        self.cache.save(trace)
        if self.writer is None:
            return
        record = {"trace_id": str(trace["trace_id"]), "kind": trace.get("kind"), "pipeline": trace.get("pipeline"), "duration_ms": trace.get("duration_ms"), "input_summary": input_summary(trace)[:500], "data": trace, "created_at": _parse_created(trace.get("created_at"))}

        def write(session) -> None:
            existing = session.get(PipelineTraceRecord, record["trace_id"])
            if existing is None:
                session.add(PipelineTraceRecord(**record))
            else:
                for key, value in record.items():
                    setattr(existing, key, value)

        self.writer.submit(write)
        if time.monotonic() - self._last_purge > PURGE_INTERVAL_SECONDS:
            self._last_purge = time.monotonic()
            self.writer.submit(lambda session: session.execute(delete(PipelineTraceRecord).where(PipelineTraceRecord.created_at < self._cutoff())))

    def purge_expired(self) -> int:
        if self.db is None:
            return 0
        with self.db.session() as session:
            result = session.execute(delete(PipelineTraceRecord).where(PipelineTraceRecord.created_at < self._cutoff()))
            return int(result.rowcount or 0)

    def get(self, trace_id: str) -> dict[str, Any] | None:
        cached = self.cache.get(trace_id)
        if cached is not None:
            return cached if _parse_created(cached.get("created_at")) >= self._cutoff() else None
        if self.db is None:
            return None
        try:
            with self.db.session() as session:
                row = session.get(PipelineTraceRecord, trace_id)
                if row is None or as_utc(row.created_at) < self._cutoff():
                    return None
                return row.data
        except DatabaseUnavailable as exc:
            logger.warning("trace lookup failed: %s", exc)
            return None

    def list(self, *, q: str | None = None, kind: str | None = None, limit: int = 50, offset: int = 0) -> tuple[int, list[dict[str, Any]]]:
        if self.db is None:
            return self.cache.list(q=q, kind=kind, limit=limit, offset=offset)
        if self.writer is not None:
            self.writer.flush(timeout=1.0)
        try:
            with self.db.session() as session:
                filters = [PipelineTraceRecord.created_at >= self._cutoff()]
                if kind:
                    filters.append(PipelineTraceRecord.kind == kind)
                if q:
                    needle = f"%{q.strip().lower()}%"
                    filters.append(or_(func.lower(PipelineTraceRecord.trace_id).like(needle), func.lower(PipelineTraceRecord.input_summary).like(needle), func.lower(PipelineTraceRecord.pipeline).like(needle)))
                total = session.scalar(select(func.count()).select_from(PipelineTraceRecord).where(*filters)) or 0
                rows = session.scalars(select(PipelineTraceRecord).where(*filters).order_by(PipelineTraceRecord.created_at.desc()).offset(offset).limit(limit)).all()
                return int(total), [row.data for row in rows]
        except DatabaseUnavailable as exc:
            logger.warning("trace listing failed, serving the in-memory cache: %s", exc)
            return self.cache.list(q=q, kind=kind, limit=limit, offset=offset)
