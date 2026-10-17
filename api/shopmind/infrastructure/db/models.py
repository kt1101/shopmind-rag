"""SQLAlchemy 2 models for the system of record (docs/REFACTOR_PLAN.md §6.1, ADR 0002).

Rules: no vectors and no image bytes in the database; JSON columns use ``JSON`` with a JSONB
variant on PostgreSQL so the same models run on SQLite (tests, dev) and Postgres (docker).
"""
from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Index, Integer, MetaData, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

JSONType = JSON().with_variant(JSONB(), "postgresql")

NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


def utcnow() -> datetime:
    return datetime.now(UTC)


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)
    type_annotation_map = {dict[str, Any]: JSONType, list[Any]: JSONType, datetime: DateTime(timezone=True)}


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True)
    password_hash: Mapped[str] = mapped_column(String(128))
    role: Mapped[str] = mapped_column(String(32), default="admin")
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    last_login_at: Mapped[datetime | None] = mapped_column(default=None)


class ChatSession(Base):
    __tablename__ = "chat_sessions"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=utcnow)


class ChatMessage(Base):
    __tablename__ = "chat_messages"
    __table_args__ = (Index("ix_chat_messages_session_created", "session_id", "id"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("chat_sessions.id", ondelete="CASCADE"))
    role: Mapped[str] = mapped_column(String(16))
    content: Mapped[str] = mapped_column(Text)
    extra: Mapped[dict[str, Any] | None] = mapped_column(default=None)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


class SearchEvent(Base):
    """One row per search / RAG / chat request (``kind``); chat-only columns are null for search."""
    __tablename__ = "search_events"
    __table_args__ = (Index("ix_search_events_kind_created", "kind", "created_at"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    trace_id: Mapped[str | None] = mapped_column(String(64), index=True, default=None)
    kind: Mapped[str] = mapped_column(String(32), default="search")
    query: Mapped[str | None] = mapped_column(String(1000), default=None)
    mode: Mapped[str | None] = mapped_column(String(32), default=None)
    pipeline: Mapped[str | None] = mapped_column(String(64), default=None)
    latency_ms: Mapped[float | None] = mapped_column(Float, default=None)
    result_count: Mapped[int | None] = mapped_column(Integer, default=None)
    filters: Mapped[dict[str, Any] | None] = mapped_column(default=None)
    session_id: Mapped[str | None] = mapped_column(String(64), default=None)
    intent: Mapped[str | None] = mapped_column(String(32), default=None)
    insufficient_evidence: Mapped[bool | None] = mapped_column(Boolean, default=None)
    created_at: Mapped[datetime] = mapped_column(default=utcnow, index=True)


class ClickEvent(Base):
    __tablename__ = "click_events"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    trace_id: Mapped[str] = mapped_column(String(64), index=True)
    product_id: Mapped[str] = mapped_column(String(64))
    rank: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(default=utcnow, index=True)


class PipelineTraceRecord(Base):
    __tablename__ = "pipeline_traces"
    trace_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    kind: Mapped[str | None] = mapped_column(String(32), default=None, index=True)
    pipeline: Mapped[str | None] = mapped_column(String(64), default=None)
    duration_ms: Mapped[float | None] = mapped_column(Float, default=None)
    input_summary: Mapped[str | None] = mapped_column(String(500), default=None)
    data: Mapped[dict[str, Any]] = mapped_column()
    created_at: Mapped[datetime] = mapped_column(default=utcnow, index=True)


class Feedback(Base):
    __tablename__ = "feedback"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    target: Mapped[str] = mapped_column(String(16))
    trace_id: Mapped[str | None] = mapped_column(String(64), index=True, default=None)
    rating: Mapped[int] = mapped_column(Integer)
    product_id: Mapped[str | None] = mapped_column(String(64), default=None)
    query: Mapped[str | None] = mapped_column(String(1000), default=None)
    comment: Mapped[str | None] = mapped_column(Text, default=None)
    created_at: Mapped[datetime] = mapped_column(default=utcnow, index=True)


class RelevanceJudgment(Base):
    __tablename__ = "relevance_judgments"
    __table_args__ = (UniqueConstraint("query", "product_id", "annotator", name="uq_relevance_judgments_item_annotator"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    query: Mapped[str] = mapped_column(String(1000), index=True)
    product_id: Mapped[str] = mapped_column(String(64))
    grade: Mapped[int] = mapped_column(Integer)
    annotator: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=utcnow)


class ConfigProfile(Base):
    __tablename__ = "config_profiles"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(128))
    overrides: Mapped[dict[str, Any]] = mapped_column(default=dict)
    active: Mapped[bool] = mapped_column(Boolean, default=False)
    created_by: Mapped[str | None] = mapped_column(String(64), default=None)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    activated_at: Mapped[datetime | None] = mapped_column(default=None)


class Policy(Base):
    """Policy CMS section. ``published_snapshot`` keeps the last published fields while a draft is edited."""
    __tablename__ = "policies"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    policy_id: Mapped[str] = mapped_column(String(64))
    section_id: Mapped[str] = mapped_column(String(128), unique=True)
    title: Mapped[str] = mapped_column(String(300))
    content: Mapped[str] = mapped_column(Text)
    policy_type: Mapped[str] = mapped_column(String(64))
    version: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(16), default="draft")
    effective_date: Mapped[str | None] = mapped_column(String(32), default=None)
    source_url: Mapped[str | None] = mapped_column(String(500), default=None)
    extra: Mapped[dict[str, Any] | None] = mapped_column(default=None)
    published_version: Mapped[int | None] = mapped_column(Integer, default=None)
    published_snapshot: Mapped[dict[str, Any] | None] = mapped_column(default=None)
    updated_by: Mapped[str | None] = mapped_column(String(64), default=None)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=utcnow)


class ProductOverlay(Base):
    """Synthetic commerce data (price, stock) for demo; always flagged ``synthetic``."""
    __tablename__ = "products_overlay"
    product_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    price_amount: Mapped[float] = mapped_column(Float)
    currency: Mapped[str] = mapped_column(String(8), default="USD")
    in_stock: Mapped[bool] = mapped_column(Boolean, default=True)
    quantity: Mapped[int] = mapped_column(Integer, default=0)
    synthetic: Mapped[bool] = mapped_column(Boolean, default=True)
    updated_at: Mapped[datetime] = mapped_column(default=utcnow)


class Job(Base):
    __tablename__ = "jobs"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    type: Mapped[str] = mapped_column(String(64), index=True)
    status: Mapped[str] = mapped_column(String(16), default="queued", index=True)
    params: Mapped[dict[str, Any]] = mapped_column(default=dict)
    result: Mapped[dict[str, Any] | None] = mapped_column(default=None)
    log: Mapped[str] = mapped_column(Text, default="")
    error: Mapped[str | None] = mapped_column(Text, default=None)
    created_by: Mapped[str | None] = mapped_column(String(64), default=None)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    started_at: Mapped[datetime | None] = mapped_column(default=None)
    finished_at: Mapped[datetime | None] = mapped_column(default=None)


class EvalRun(Base):
    __tablename__ = "eval_runs"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    run_key: Mapped[str] = mapped_column(String(300), unique=True)
    name: Mapped[str] = mapped_column(String(200))
    kind: Mapped[str] = mapped_column(String(8))
    metrics: Mapped[dict[str, Any]] = mapped_column(default=dict)
    config: Mapped[dict[str, Any]] = mapped_column(default=dict)
    details: Mapped[dict[str, Any] | None] = mapped_column(default=None)
    summary: Mapped[str | None] = mapped_column(Text, default=None)
    job_id: Mapped[int | None] = mapped_column(Integer, default=None)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    imported_at: Mapped[datetime] = mapped_column(default=utcnow)
