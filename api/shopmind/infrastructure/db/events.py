"""Usage events (search / chat / click), feedback and the admin dashboard aggregates.

``EventLog.record_*`` are called on request paths: they only enqueue a background write and
never raise. Reads (``stats``, ``list_feedback``) raise ``DatabaseUnavailable`` so admin
endpoints can answer 503.
"""
from __future__ import annotations

import logging
import math
from collections import Counter, defaultdict
from datetime import UTC, date, datetime, timedelta
from typing import Any

from sqlalchemy import func, select

from shopmind.infrastructure.db.engine import Database, as_utc, iso
from shopmind.infrastructure.db.models import ClickEvent, Feedback, SearchEvent
from shopmind.infrastructure.db.writer import BackgroundWriter

logger = logging.getLogger("shopmind.db.events")

MAX_QUERY_CHARS = 1000


def _clip(value: Any, limit: int = MAX_QUERY_CHARS) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text[:limit] if text else None


def _jsonable(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, dict):
        return {str(key): _jsonable(item) for key, item in value.items() if item is not None}
    if isinstance(value, (list, tuple, set)):
        return [_jsonable(item) for item in value]
    if hasattr(value, "value"):
        return _jsonable(value.value)
    return str(value)


def percentile(values: list[float], fraction: float) -> float | None:
    """Nearest-rank percentile (same convention as the evaluation runners)."""
    if not values:
        return None
    ordered = sorted(values)
    index = max(0, math.ceil(fraction * len(ordered)) - 1)
    return round(ordered[index], 3)


class EventLog:
    """Component ``event_log``."""

    def __init__(self, db: Database, writer: BackgroundWriter) -> None:
        self.db = db
        self.writer = writer

    # -- writes (request path) ----------------------------------------------------------------
    def _submit(self, row: Any) -> bool:
        try:
            return self.writer.submit(lambda session: session.add(row))
        except Exception:  # pragma: no cover - defensive, the writer itself never raises
            logger.warning("event logging failed", exc_info=True)
            return False

    def record_search(self, trace_id: str | None, query: str | None, mode: str | None, pipeline: str | None, latency_ms: float | None, result_count: int | None, filters: dict[str, Any] | None = None, *, kind: str = "search") -> bool:
        return self._submit(SearchEvent(trace_id=_clip(trace_id, 64), kind=kind, query=_clip(query), mode=_clip(_jsonable(mode), 32), pipeline=_clip(pipeline, 64), latency_ms=None if latency_ms is None else float(latency_ms), result_count=None if result_count is None else int(result_count), filters=_jsonable(filters) or None))

    def record_chat(self, trace_id: str | None, session_id: str | None, intent: str | None, latency_ms: float | None, insufficient_evidence: bool | None, *, query: str | None = None, pipeline: str | None = None, kind: str = "chat") -> bool:
        return self._submit(SearchEvent(trace_id=_clip(trace_id, 64), kind=kind, query=_clip(query), pipeline=_clip(pipeline or kind, 64), latency_ms=None if latency_ms is None else float(latency_ms), session_id=_clip(session_id, 64), intent=_clip(_jsonable(intent), 32), insufficient_evidence=None if insufficient_evidence is None else bool(insufficient_evidence)))

    def record_click(self, trace_id: str, product_id: str, rank: int) -> bool:
        return self._submit(ClickEvent(trace_id=str(trace_id)[:64], product_id=str(product_id)[:64], rank=int(rank)))

    def flush(self, timeout: float = 5.0) -> bool:
        return self.writer.flush(timeout)

    # -- feedback ------------------------------------------------------------------------------
    def add_feedback(self, *, target: str, trace_id: str | None, rating: int, product_id: str | None = None, query: str | None = None, comment: str | None = None) -> int:
        with self.db.session() as session:
            row = Feedback(target=target, trace_id=_clip(trace_id, 64), rating=int(rating), product_id=_clip(product_id, 64), query=_clip(query), comment=_clip(comment, 4000))
            session.add(row)
            session.flush()
            return int(row.id)

    def list_feedback(self, *, limit: int = 20, offset: int = 0, rating: int | None = None, target: str | None = None) -> tuple[int, list[dict[str, Any]]]:
        with self.db.session() as session:
            filters = []
            if rating is not None:
                filters.append(Feedback.rating == rating)
            if target:
                filters.append(Feedback.target == target)
            total = session.scalar(select(func.count()).select_from(Feedback).where(*filters)) or 0
            rows = session.scalars(select(Feedback).where(*filters).order_by(Feedback.created_at.desc(), Feedback.id.desc()).offset(offset).limit(limit)).all()
            return int(total), [{"id": row.id, "target": row.target, "trace_id": row.trace_id, "rating": row.rating, "query": row.query, "product_id": row.product_id, "comment": row.comment, "created_at": iso(row.created_at)} for row in rows]

    # -- dashboard -----------------------------------------------------------------------------
    def stats(self, days: int = 7, *, now: datetime | None = None, top: int = 10) -> dict[str, Any]:
        self.writer.flush(timeout=1.0)
        now = now or datetime.now(UTC)
        first_day: date = (now - timedelta(days=days - 1)).date()
        since = datetime(first_day.year, first_day.month, first_day.day, tzinfo=UTC)
        with self.db.session() as session:
            events = session.execute(select(SearchEvent.kind, SearchEvent.query, SearchEvent.pipeline, SearchEvent.mode, SearchEvent.latency_ms, SearchEvent.result_count, SearchEvent.insufficient_evidence, SearchEvent.created_at).where(SearchEvent.created_at >= since)).all()
            ratings = dict(session.execute(select(Feedback.rating, func.count()).where(Feedback.created_at >= since).group_by(Feedback.rating)).all())
            clicks = session.execute(select(ClickEvent.trace_id, ClickEvent.rank).where(ClickEvent.created_at >= since)).all()

        daily_searches: Counter[str] = Counter()
        daily_chats: Counter[str] = Counter()
        latency: dict[str, list[float]] = defaultdict(list)
        top_queries: Counter[str] = Counter()
        zero_queries: Counter[str] = Counter()
        searches = chats = zero = abstain = answered = 0
        for kind, query, pipeline, mode, latency_ms, result_count, insufficient, created_at in events:
            day = as_utc(created_at).date().isoformat()
            name = pipeline or (f"search.{mode}" if mode else kind)
            if latency_ms is not None:
                latency[name].append(float(latency_ms))
            if kind in {"chat", "rag", "compare"}:
                chats += 1
                daily_chats[day] += 1
                if insufficient is not None:
                    answered += 1
                    abstain += bool(insufficient)
                continue
            searches += 1
            daily_searches[day] += 1
            normalized = (query or "").strip().lower()
            if normalized:
                top_queries[normalized] += 1
            if result_count == 0:
                zero += 1
                if normalized:
                    zero_queries[normalized] += 1
        dates = [(first_day + timedelta(days=offset)).isoformat() for offset in range(days)]
        positive, negative = int(ratings.get(1, 0)), int(ratings.get(-1, 0))
        clicked_traces = {trace_id for trace_id, _ in clicks}
        first_click: dict[str, int] = {}
        for trace_id, rank in clicks:
            first_click[trace_id] = min(rank, first_click.get(trace_id, rank))
        return {
            "totals": {
                "searches": searches,
                "chats": chats,
                "feedback_positive": positive,
                "feedback_negative": negative,
                "zero_result_rate": round(zero / searches, 4) if searches else 0.0,
                "abstain_rate": round(abstain / answered, 4) if answered else 0.0,
                "clicks": len(clicks),
                "ctr": round(len(clicked_traces) / searches, 4) if searches else 0.0,
                "click_mrr": round(sum(1 / rank for rank in first_click.values() if rank > 0) / searches, 4) if searches else 0.0,
            },
            "latency": {name: {"p50": percentile(values, 0.5), "p95": percentile(values, 0.95), "count": len(values)} for name, values in sorted(latency.items())},
            "daily": [{"date": day, "searches": daily_searches.get(day, 0), "chats": daily_chats.get(day, 0)} for day in dates],
            "top_queries": [{"query": query, "count": count} for query, count in top_queries.most_common(top)],
            "zero_result_queries": [{"query": query, "count": count} for query, count in zero_queries.most_common(top)],
        }
