"""Policy CMS: draft/published policy sections, export in the ``data/policies/*.jsonl`` format.

Editing a section makes it a draft again; the last published text is kept in
``published_snapshot`` so an export (and therefore the search index) keeps serving it until the
draft is published. Publishing bumps ``version`` when it was not raised by the editor.
"""
from __future__ import annotations

import json
from collections.abc import Iterable
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

from sqlalchemy import func, select

from shopmind.infrastructure.db.engine import Database, iso
from shopmind.infrastructure.db.models import Policy

EDITABLE = ("policy_id", "section_id", "title", "content", "policy_type", "version", "effective_date", "source_url")
SNAPSHOT_FIELDS = ("policy_id", "title", "content", "policy_type", "version", "effective_date", "source_url")


class PolicyNotFound(LookupError):
    pass


class PolicyConflict(ValueError):
    pass


class PolicyValidationError(ValueError):
    def __init__(self, details: list[dict[str, str]]) -> None:
        super().__init__("policy validation failed")
        self.details = details


def policy_dict(row: Policy) -> dict[str, Any]:
    return {"id": row.id, "policy_id": row.policy_id, "section_id": row.section_id, "title": row.title, "content": row.content, "policy_type": row.policy_type, "version": row.version, "status": row.status, "effective_date": row.effective_date, "source_url": row.source_url, "published_version": row.published_version, "updated_at": iso(row.updated_at), "updated_by": row.updated_by}


def normalize_policy(data: dict[str, Any], *, existing: Policy | None = None) -> dict[str, Any]:
    """Merge + validate fields (same rules as ``shopmind.ingestion.policy_loader``); raises ``PolicyValidationError``."""
    merged = {field: getattr(existing, field) for field in EDITABLE} if existing is not None else {}
    merged.update({key: value for key, value in data.items() if key in EDITABLE and value is not None})
    details = []
    for field in ("title", "content", "section_id"):
        if not str(merged.get(field) or "").strip():
            details.append({"field": field, "message": f"{field.replace('_', ' ').capitalize()} is required"})
    try:
        version = int(merged.get("version") if merged.get("version") is not None else 1)
        if version < 1:
            raise ValueError
    except (TypeError, ValueError):
        details.append({"field": "version", "message": "Version must be a positive integer"})
        version = 1
    section_id = str(merged.get("section_id") or "").strip()
    policy_id = str(merged.get("policy_id") or "").strip() or (section_id.split(".", 1)[0] if section_id else "")
    if section_id and "." not in section_id:
        section_id = f"{policy_id}.{section_id}"
    if section_id and not section_id.startswith(f"{policy_id}."):
        details.append({"field": "section_id", "message": f"Section id must start with '{policy_id}.'"})
    if details:
        raise PolicyValidationError(details)
    return {
        "policy_id": policy_id[:64],
        "section_id": section_id[:128],
        "title": str(merged["title"]).strip()[:300],
        "content": str(merged["content"]).strip(),
        "policy_type": (str(merged.get("policy_type") or "").strip() or policy_id)[:64],
        "version": version,
        "effective_date": (str(merged.get("effective_date") or "").strip() or None),
        "source_url": merged.get("source_url") or None,
    }


class PolicyRepository:
    def __init__(self, db: Database) -> None:
        self.db = db

    def list(self, *, status: str | None = None) -> list[dict[str, Any]]:
        with self.db.session() as session:
            statement = select(Policy)
            if status:
                statement = statement.where(Policy.status == status)
            return [policy_dict(row) for row in session.scalars(statement.order_by(Policy.policy_id, Policy.section_id))]

    def get(self, policy_pk: int) -> dict[str, Any]:
        with self.db.session() as session:
            row = session.get(Policy, int(policy_pk))
            if row is None:
                raise PolicyNotFound(f"policy {policy_pk} not found")
            return policy_dict(row)

    def count(self) -> int:
        with self.db.session() as session:
            return int(session.scalar(select(func.count()).select_from(Policy)) or 0)

    def create(self, data: dict[str, Any], *, user: str | None = None) -> dict[str, Any]:
        values = normalize_policy(data)
        with self.db.session() as session:
            if session.scalar(select(Policy.id).where(Policy.section_id == values["section_id"])) is not None:
                raise PolicyConflict(f"section {values['section_id']} already exists")
            now = datetime.now(UTC)
            row = Policy(**values, status="draft", updated_by=user, created_at=now, updated_at=now)
            session.add(row)
            session.flush()
            return policy_dict(row)

    def update(self, policy_pk: int, data: dict[str, Any], *, user: str | None = None) -> dict[str, Any]:
        with self.db.session() as session:
            row = session.get(Policy, int(policy_pk))
            if row is None:
                raise PolicyNotFound(f"policy {policy_pk} not found")
            values = normalize_policy(data, existing=row)
            if values["section_id"] != row.section_id and session.scalar(select(Policy.id).where(Policy.section_id == values["section_id"], Policy.id != row.id)) is not None:
                raise PolicyConflict(f"section {values['section_id']} already exists")
            for key, value in values.items():
                setattr(row, key, value)
            row.status = "draft"
            row.updated_by = user
            row.updated_at = datetime.now(UTC)
            session.flush()
            return policy_dict(row)

    def publish(self, ids: Iterable[int] | None = None, *, user: str | None = None) -> list[dict[str, Any]]:
        """Publish drafts (all, or only ``ids``); returns the published rows."""
        wanted = None if ids is None else {int(value) for value in ids}
        published = []
        with self.db.session() as session:
            for row in session.scalars(select(Policy).where(Policy.status == "draft").order_by(Policy.id)):
                if wanted is not None and row.id not in wanted:
                    continue
                if row.published_version is not None and row.version <= row.published_version:
                    row.version = row.published_version + 1
                row.status = "published"
                row.published_version = row.version
                row.published_snapshot = {field: getattr(row, field) for field in SNAPSHOT_FIELDS}
                row.updated_by = user
                row.updated_at = datetime.now(UTC)
                published.append(row)
            session.flush()
            return [policy_dict(row) for row in published]

    # -- import / export -----------------------------------------------------------------------
    def export_rows(self) -> list[dict[str, Any]]:
        """Published content in the ``policy_loader`` JSONL schema (drafts serve their last published snapshot)."""
        rows = []
        with self.db.session() as session:
            for row in session.scalars(select(Policy).order_by(Policy.policy_id, Policy.section_id)):
                if row.status == "published":
                    source = {field: getattr(row, field) for field in SNAPSHOT_FIELDS}
                elif row.published_snapshot:
                    source = dict(row.published_snapshot)
                else:
                    continue
                extra = dict(row.extra or {})
                metadata = dict(extra.get("metadata") or {})
                metadata.update({"cms_id": row.id, "cms_version": int(source["version"])})
                if extra.get("source_version"):
                    metadata["source_version"] = extra["source_version"]
                rows.append({
                    "policy_id": source["policy_id"], "section_id": row.section_id, "title": source["title"], "content": source["content"],
                    "policy_type": source["policy_type"], "version": f"v{source['version']}",
                    "effective_date": source.get("effective_date") or date.today().isoformat(), "source_url": source.get("source_url"), "metadata": metadata,
                })
        return rows

    def export_jsonl(self, path: str | Path) -> int:
        rows = self.export_rows()
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("".join(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n" for row in rows), encoding="utf-8", newline="\n")
        return len(rows)

    def import_sections(self, sections: Iterable[Any], *, user: str = "seed") -> int:
        """Insert sections (``PolicySection`` or dicts) as published v1 when their section id is new."""
        added = 0
        with self.db.session() as session:
            known = set(session.scalars(select(Policy.section_id)))
            now = datetime.now(UTC)
            for section in sections:
                raw = section.to_dict() if hasattr(section, "to_dict") else dict(section)
                if raw["section_id"] in known:
                    continue
                row = Policy(policy_id=raw["policy_id"], section_id=raw["section_id"], title=raw["title"], content=raw["content"], policy_type=raw["policy_type"], version=1, status="published", effective_date=raw.get("effective_date"), source_url=raw.get("source_url"), extra={"source_version": raw.get("version"), "metadata": raw.get("metadata") or {}}, published_version=1, updated_by=user, created_at=now, updated_at=now)
                row.published_snapshot = {field: getattr(row, field) for field in SNAPSHOT_FIELDS}
                session.add(row)
                known.add(raw["section_id"])
                added += 1
        return added

    def seed_from(self, source: str | Path) -> int:
        from shopmind.ingestion.policy_loader import load_policy_sections

        path = Path(source)
        if not path.exists():
            return 0
        files = [path] if path.is_file() else ([path] if (path / "shopmind_policies.jsonl").exists() or any(path.glob("*.y*ml")) else sorted(path.glob("*.jsonl")))
        added = 0
        for item in files:
            added += self.import_sections(load_policy_sections(item))
        return added
