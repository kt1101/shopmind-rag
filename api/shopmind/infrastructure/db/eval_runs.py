"""Evaluation runs: import ``runs/**/metrics.json`` (A1 ``evaluation.runner`` and A3
``evaluation.rag.runner``) into ``eval_runs`` so the Admin console can list and compare them.

Run directories are identified by their path relative to the runs root (``run_key``); importing
is an idempotent upsert.
"""
from __future__ import annotations

import json
import logging
import re
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import yaml
from sqlalchemy import select

from shopmind.infrastructure.db.engine import Database, iso
from shopmind.infrastructure.db.models import EvalRun

logger = logging.getLogger("shopmind.db.eval_runs")

DETAIL_KEYS = ("metrics_successful_only", "success_rate", "latency_ms", "metrics_by_language", "metrics_by_query_type", "metrics_by_group", "metrics_by_split", "successful_queries", "failed_queries", "case_count", "successful_cases", "failed_cases", "error_counts", "label_statuses", "dataset_version", "index_version", "embedding_model", "embedding_version", "recall_at_10_ceiling", "exact_id_top_1_hit_rate")
A1_CONFIG_KEYS = ("experiment_name", "dataset_version", "index_version", "embedding_model", "embedding_version", "retrieval", "fusion", "reranker")
_STAMP = re.compile(r"^(\d{8}T\d{6})(\d*)Z")


class EvalRunNotFound(LookupError):
    pass


def run_dict(row: EvalRun, *, detail: bool = False) -> dict[str, Any]:
    data = {"id": row.id, "name": row.name, "kind": row.kind, "created_at": iso(row.created_at), "metrics": dict(row.metrics or {}), "config": dict(row.config or {}), "run_key": row.run_key, "job_id": row.job_id}
    if detail:
        data["details"] = dict(row.details or {})
        data["summary"] = row.summary
    return data


def _created_at(payload: dict[str, Any], run_dir: Path) -> datetime:
    value = payload.get("created_at")
    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)
        except ValueError:
            pass
    match = _STAMP.match(run_dir.name)
    if match:
        return datetime.strptime(match.group(1), "%Y%m%dT%H%M%S").replace(tzinfo=UTC)
    return datetime.fromtimestamp(run_dir.stat().st_mtime, UTC)


def parse_run(metrics_path: Path, runs_root: Path) -> dict[str, Any]:
    payload = json.loads(metrics_path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"{metrics_path} is not a JSON object")
    run_dir = metrics_path.parent
    run_key = run_dir.relative_to(runs_root).as_posix()
    is_a3 = "case_count" in payload or "label_statuses" in payload or "a3" in run_dir.relative_to(runs_root).parts
    config = payload.get("config") if isinstance(payload.get("config"), dict) else None
    config_path = run_dir / "config.yaml"
    if config is None and config_path.exists():
        try:
            loaded = yaml.safe_load(config_path.read_text(encoding="utf-8"))
            config = loaded if isinstance(loaded, dict) else None
        except yaml.YAMLError:
            config = None
    if config is None:
        config = {key: payload[key] for key in A1_CONFIG_KEYS if key in payload}
    summary_path = run_dir / "summary.md"
    metrics = payload.get("metrics") if isinstance(payload.get("metrics"), dict) else {}
    return {
        "run_key": run_key,
        "name": str(payload.get("experiment_name") or run_dir.name)[:200],
        "kind": "a3" if is_a3 else "a1",
        "metrics": metrics,
        "config": config,
        "details": {key: payload[key] for key in DETAIL_KEYS if key in payload},
        "summary": summary_path.read_text(encoding="utf-8")[:20000] if summary_path.exists() else None,
        "created_at": _created_at(payload, run_dir),
    }


class EvalRunRepository:
    def __init__(self, db: Database) -> None:
        self.db = db

    def list(self, *, kind: str | None = None) -> list[dict[str, Any]]:
        with self.db.session() as session:
            statement = select(EvalRun)
            if kind:
                statement = statement.where(EvalRun.kind == kind)
            return [run_dict(row) for row in session.scalars(statement.order_by(EvalRun.created_at.desc(), EvalRun.id.desc()))]

    def get(self, run_id: int) -> dict[str, Any]:
        with self.db.session() as session:
            row = session.get(EvalRun, int(run_id))
            if row is None:
                raise EvalRunNotFound(f"eval run {run_id} not found")
            return run_dict(row, detail=True)

    def upsert(self, values: dict[str, Any], *, job_id: int | None = None) -> int:
        with self.db.session() as session:
            row = session.scalar(select(EvalRun).where(EvalRun.run_key == values["run_key"]))
            if row is None:
                row = EvalRun(**values, job_id=job_id)
                session.add(row)
            else:
                for key, value in values.items():
                    setattr(row, key, value)
                if job_id is not None:
                    row.job_id = job_id
                row.imported_at = datetime.now(UTC)
            session.flush()
            return int(row.id)

    def import_dir(self, runs_root: str | Path, *, job_id: int | None = None, since: datetime | None = None) -> list[int]:
        """Upsert every ``metrics.json`` under ``runs_root`` (optionally only files modified after ``since``)."""
        root = Path(runs_root)
        if not root.is_dir():
            return []
        imported = []
        for metrics_path in sorted(root.rglob("metrics.json")):
            if since is not None and datetime.fromtimestamp(metrics_path.stat().st_mtime, UTC) < since:
                continue
            try:
                imported.append(self.upsert(parse_run(metrics_path, root), job_id=job_id))
            except Exception as exc:  # one broken run must not stop the import
                logger.warning("skipping eval run %s: %s", metrics_path, exc)
        return imported
