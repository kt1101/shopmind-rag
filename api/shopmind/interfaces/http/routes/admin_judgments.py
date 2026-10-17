"""Relevance annotation: per-annotator judgments, qrels export and inter-annotator agreement."""
from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Literal

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field

from shopmind.application.admin.judgments import agreement, load_benchmark_queries, qrels_lines
from shopmind.infrastructure.db.repositories import JudgmentRepository
from shopmind.interfaces.http.admin_support import database
from shopmind.interfaces.http.deps import get_config, require_auth

router = APIRouter(prefix="/api/v1/admin/judgments", tags=["admin"])
guarded = [Depends(require_auth)]


class JudgmentIn(BaseModel):
    query: str = Field(min_length=1, max_length=1000)
    product_id: str = Field(min_length=1, max_length=64)
    grade: Literal[0, 1, 2]


@router.get("", dependencies=guarded)
def list_judgments(request: Request, query: str | None = Query(None, max_length=1000), annotator: str | None = Query(None, max_length=64), limit: int = Query(500, ge=1, le=5000), user: dict[str, Any] = Depends(require_auth)) -> dict[str, Any]:
    """The caller's judgments by default; ``annotator=*`` lists everyone's."""
    who = None if annotator == "*" else (annotator or user["username"])
    return {"items": JudgmentRepository(database(request)).list(query=query or None, annotator=who, limit=limit)}


@router.post("")
def save_judgment(payload: JudgmentIn, request: Request, user: dict[str, Any] = Depends(require_auth)) -> dict[str, Any]:
    return JudgmentRepository(database(request)).upsert(payload.query, payload.product_id.strip(), payload.grade, user["username"])


@router.get("/export", dependencies=guarded)
def export_qrels(request: Request, aggregate: str = Query("max", pattern="^(max|mean|median)$"), annotator: str | None = Query(None, max_length=64)) -> Response:
    repository = JudgmentRepository(database(request))
    judgments = repository.all() if not annotator else repository.list(annotator=annotator, limit=1_000_000)
    benchmark = load_benchmark_queries(get_config(request).jobs.eval_queries)
    body = "".join(line + "\n" for line in qrels_lines(judgments, benchmark, aggregate=aggregate))
    filename = f"qrels_{datetime.now(UTC).strftime('%Y%m%dT%H%M%SZ')}.jsonl"
    return Response(content=body, media_type="application/x-ndjson", headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@router.get("/agreement", dependencies=guarded)
def judgment_agreement(request: Request) -> dict[str, Any]:
    return agreement(JudgmentRepository(database(request)).all())
