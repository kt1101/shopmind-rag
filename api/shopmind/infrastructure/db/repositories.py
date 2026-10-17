"""Small repositories for config profiles and relevance judgments."""
from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func, select, update

from shopmind.infrastructure.db.engine import Database, iso
from shopmind.infrastructure.db.models import ConfigProfile, RelevanceJudgment


def _profile(row: ConfigProfile) -> dict[str, Any]:
    return {"id": row.id, "name": row.name, "created_at": iso(row.created_at), "created_by": row.created_by, "overrides": dict(row.overrides or {}), "active": bool(row.active), "activated_at": iso(row.activated_at)}


class ProfileRepository:
    """``ProfileStore`` for ``ConfigService`` (newest first; exactly one active profile)."""

    def __init__(self, db: Database) -> None:
        self.db = db

    def list(self) -> list[dict[str, Any]]:
        with self.db.session() as session:
            return [_profile(row) for row in session.scalars(select(ConfigProfile).order_by(ConfigProfile.id.desc()))]

    def active(self) -> dict[str, Any] | None:
        with self.db.session() as session:
            row = session.scalar(select(ConfigProfile).where(ConfigProfile.active.is_(True)).order_by(ConfigProfile.activated_at.desc(), ConfigProfile.id.desc()).limit(1))
            return None if row is None else _profile(row)

    def get(self, profile_id: int) -> dict[str, Any] | None:
        with self.db.session() as session:
            row = session.get(ConfigProfile, int(profile_id))
            return None if row is None else _profile(row)

    def create(self, name: str, overrides: dict[str, Any], created_by: str | None, *, activate: bool = True) -> dict[str, Any]:
        now = datetime.now(UTC)
        with self.db.session() as session:
            if activate:
                session.execute(update(ConfigProfile).where(ConfigProfile.active.is_(True)).values(active=False))
            row = ConfigProfile(name=name, overrides=dict(overrides), created_by=created_by, created_at=now, active=activate, activated_at=now if activate else None)
            session.add(row)
            session.flush()
            return _profile(row)

    def activate(self, profile_id: int) -> dict[str, Any] | None:
        with self.db.session() as session:
            row = session.get(ConfigProfile, int(profile_id))
            if row is None:
                return None
            session.execute(update(ConfigProfile).where(ConfigProfile.active.is_(True), ConfigProfile.id != row.id).values(active=False))
            row.active = True
            row.activated_at = datetime.now(UTC)
            session.flush()
            return _profile(row)


def _judgment(row: RelevanceJudgment) -> dict[str, Any]:
    return {"id": row.id, "query": row.query, "product_id": row.product_id, "grade": row.grade, "annotator": row.annotator, "updated_at": iso(row.updated_at)}


class JudgmentRepository:
    def __init__(self, db: Database) -> None:
        self.db = db

    def upsert(self, query: str, product_id: str, grade: int, annotator: str) -> dict[str, Any]:
        query = query.strip()[:1000]
        now = datetime.now(UTC)
        with self.db.session() as session:
            row = session.scalar(select(RelevanceJudgment).where(RelevanceJudgment.query == query, RelevanceJudgment.product_id == product_id, RelevanceJudgment.annotator == annotator))
            if row is None:
                row = RelevanceJudgment(query=query, product_id=product_id, grade=grade, annotator=annotator, created_at=now, updated_at=now)
                session.add(row)
            else:
                row.grade = grade
                row.updated_at = now
            session.flush()
            return _judgment(row)

    def list(self, *, query: str | None = None, annotator: str | None = None, limit: int = 500) -> list[dict[str, Any]]:
        with self.db.session() as session:
            statement = select(RelevanceJudgment)
            if query:
                statement = statement.where(RelevanceJudgment.query == query.strip())
            if annotator:
                statement = statement.where(RelevanceJudgment.annotator == annotator)
            rows = session.scalars(statement.order_by(RelevanceJudgment.updated_at.desc(), RelevanceJudgment.id.desc()).limit(limit))
            return [_judgment(row) for row in rows]

    def all(self) -> list[dict[str, Any]]:
        with self.db.session() as session:
            return [_judgment(row) for row in session.scalars(select(RelevanceJudgment).order_by(RelevanceJudgment.id))]

    def count(self) -> int:
        with self.db.session() as session:
            return int(session.scalar(select(func.count()).select_from(RelevanceJudgment)) or 0)
