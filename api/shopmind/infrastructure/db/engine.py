"""Engine + session factory for the system of record.

``Database`` wraps one SQLAlchemy engine. It never raises at construction time (no connection is
opened), so the API starts even when PostgreSQL is down; callers use ``session()`` and treat
``DatabaseUnavailable`` as "degrade". ``Database.in_memory()`` backs every platform feature with a
private in-memory SQLite database when ``database.enabled`` is false (tests, eval runs).
"""
from __future__ import annotations

import contextlib
import logging
import threading
import time
from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import Engine, make_url
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from shopmind.infrastructure.db.models import Base

logger = logging.getLogger("shopmind.db")

MIGRATIONS_DIR = Path(__file__).resolve().parent / "migrations"


class DatabaseUnavailable(RuntimeError):
    """The database could not be reached (or a statement failed); the feature degrades."""


def as_utc(value: datetime | None) -> datetime | None:
    """SQLite drops tzinfo; every stored timestamp is UTC."""
    if value is None:
        return None
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def iso(value: datetime | None) -> str | None:
    value = as_utc(value)
    return None if value is None else value.isoformat().replace("+00:00", "Z")


def redact_url(url: str) -> str:
    try:
        return make_url(url).render_as_string(hide_password=True)
    except Exception:
        return "<invalid database url>"


class Database:
    def __init__(self, url: str, *, echo: bool = False, connect_timeout: int = 5, enabled: bool = True) -> None:
        self.url = url
        self.enabled = enabled
        parsed = make_url(url)
        self.dialect = parsed.get_backend_name()
        memory = self.dialect == "sqlite" and (parsed.database in (None, "", ":memory:"))
        self.in_memory = memory
        kwargs: dict[str, Any] = {"echo": echo, "future": True}
        if self.dialect == "sqlite":
            kwargs["connect_args"] = {"check_same_thread": False, "timeout": 15}
            if memory:
                kwargs["poolclass"] = StaticPool
            elif parsed.database:
                Path(parsed.database).expanduser().parent.mkdir(parents=True, exist_ok=True)
        else:
            kwargs["pool_pre_ping"] = True
            if self.dialect == "postgresql":
                kwargs["connect_args"] = {"connect_timeout": connect_timeout}
        self.engine: Engine = create_engine(url, **kwargs)
        self._sessions = sessionmaker(self.engine, expire_on_commit=False)
        # One shared connection (StaticPool) must not run two transactions at once.
        self._lock: Any = threading.RLock() if memory else contextlib.nullcontext()
        self._ready = False
        self._ready_lock = threading.Lock()
        self._down_until = 0.0

    @classmethod
    def in_memory_db(cls) -> Database:
        return cls("sqlite://", enabled=False)

    @classmethod
    def from_config(cls, config: Any) -> Database:
        if not config.enabled:
            return cls.in_memory_db()
        return cls(config.url, echo=config.echo, connect_timeout=config.connect_timeout_seconds)

    # -- lifecycle ---------------------------------------------------------------------------
    def create_all(self, *, stamp: bool = True) -> None:
        """Create missing tables. On a database without Alembic history, stamp ``head`` so a
        later ``alembic upgrade head`` does not try to recreate them."""
        with self._lock:
            had_version = inspect(self.engine).has_table("alembic_version")
            Base.metadata.create_all(self.engine)
            if stamp and not had_version and not self.in_memory:
                try:
                    stamp_head(self.engine)
                except Exception:  # alembic missing or misconfigured: tables still exist
                    logger.warning("could not stamp alembic head", exc_info=True)

    def ensure_ready(self, *, auto_create: bool) -> None:
        if self._ready:
            return
        with self._ready_lock:
            if self._ready:
                return
            if auto_create or self.in_memory:
                self.create_all()
            self._ready = True

    def ping(self) -> bool:
        try:
            with self._lock, self.engine.connect() as connection:
                connection.execute(text("SELECT 1"))
            return True
        except Exception:
            return False

    def status(self) -> str:
        """For ``/ready``: ``ok`` | ``disabled`` (in-memory fallback) | ``error``."""
        if not self.enabled:
            return "disabled"
        return "ok" if self.ping() else "error"

    def dispose(self) -> None:
        self.engine.dispose()

    # -- sessions ----------------------------------------------------------------------------
    @property
    def available(self) -> bool:
        return time.monotonic() >= self._down_until

    def mark_down(self, seconds: float = 30.0) -> None:
        self._down_until = time.monotonic() + seconds

    @contextlib.contextmanager
    def session(self) -> Iterator[Session]:
        """Transactional scope: commit on success, rollback on error.

        SQLAlchemy errors are re-raised as ``DatabaseUnavailable``; connection failures also
        open a short circuit breaker so request paths do not wait on a dead server repeatedly.
        """
        if not self.available:
            raise DatabaseUnavailable("database temporarily unavailable")
        self.ensure_ready(auto_create=False)
        with self._lock:
            session = self._sessions()
            try:
                yield session
                session.commit()
            except SQLAlchemyError as exc:
                session.rollback()
                if _is_connection_error(exc):
                    self.mark_down()
                raise DatabaseUnavailable(f"database error: {type(exc).__name__}") from exc
            except BaseException:
                session.rollback()
                raise
            finally:
                session.close()


def _is_connection_error(exc: SQLAlchemyError) -> bool:
    from sqlalchemy.exc import DisconnectionError, InterfaceError, OperationalError

    if isinstance(exc, (DisconnectionError, InterfaceError)):
        return True
    if isinstance(exc, OperationalError):
        message = str(exc).lower()
        return not any(part in message for part in ("no such table", "database is locked", "does not exist"))
    return False


def alembic_config(url: str | None = None):
    from alembic.config import Config

    config = Config()
    config.set_main_option("script_location", str(MIGRATIONS_DIR))
    if url:
        config.set_main_option("sqlalchemy.url", url.replace("%", "%%"))
    return config


def stamp_head(engine: Engine) -> None:
    from alembic import command

    config = alembic_config()
    with engine.begin() as connection:
        config.attributes["connection"] = connection
        command.stamp(config, "head")


def safe_call(default: Any, fn, *args: Any, **kwargs: Any) -> Any:
    """Run ``fn``; on database errors log once and return ``default`` (graceful degradation)."""
    try:
        return fn(*args, **kwargs)
    except (DatabaseUnavailable, SQLAlchemyError) as exc:
        logger.warning("database operation %s failed: %s", getattr(fn, "__name__", fn), exc)
        return default
