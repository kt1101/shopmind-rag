"""Admin jobs and the policy CMS (publish → ``reindex_policies`` job)."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field

from shopmind.infrastructure.db.policies import PolicyRepository, PolicyValidationError
from shopmind.interfaces.http.admin_support import database, error_response, need, require_admin
from shopmind.interfaces.http.deps import require_auth

router = APIRouter(prefix="/api/v1/admin", tags=["admin"])
guarded = [Depends(require_auth)]


# -- jobs ---------------------------------------------------------------------------------------
class JobRequest(BaseModel):
    type: str = Field(min_length=1, max_length=64)
    params: dict[str, Any] = Field(default_factory=dict)


@router.get("/jobs", dependencies=guarded)
def list_jobs(request: Request, limit: int = Query(50, ge=1, le=200), offset: int = Query(0, ge=0), type: str | None = Query(None, max_length=64), status: str | None = Query(None, max_length=16)) -> dict[str, Any]:
    runner = need(request, "job_runner")
    return {"items": runner.list(limit=limit, offset=offset, job_type=type or None, status=status or None), "types": runner.types}


@router.post("/jobs", status_code=201)
def start_job(payload: JobRequest, request: Request, user: dict[str, Any] = Depends(require_admin)) -> dict[str, Any]:
    return need(request, "job_runner").submit(payload.type, payload.params, created_by=user["username"])


@router.get("/jobs/{job_id}", dependencies=guarded)
def get_job(job_id: int, request: Request) -> dict[str, Any]:
    return need(request, "job_runner").get(job_id)


# -- policies -----------------------------------------------------------------------------------
class PolicyIn(BaseModel):
    """All fields optional at the schema level so missing ones come back as ``error.details``."""
    policy_id: str | None = Field(default=None, max_length=64)
    section_id: str | None = Field(default=None, max_length=128)
    title: str | None = Field(default=None, max_length=300)
    content: str | None = Field(default=None, max_length=50000)
    policy_type: str | None = Field(default=None, max_length=64)
    version: int | str | None = None
    effective_date: str | None = Field(default=None, max_length=32)
    source_url: str | None = Field(default=None, max_length=500)


class PublishRequest(BaseModel):
    ids: list[int] | None = None


def _invalid(request: Request, exc: PolicyValidationError) -> Any:
    return error_response(request, 422, "validation_error", "; ".join(f"{item['field']}: {item['message']}" for item in exc.details), exc.details)


@router.get("/policies", dependencies=guarded)
def list_policies(request: Request, status: str | None = Query(None, pattern="^(draft|published)$")) -> dict[str, Any]:
    return {"items": PolicyRepository(database(request)).list(status=status)}


@router.get("/policies/{policy_pk}", dependencies=guarded)
def get_policy(policy_pk: int, request: Request) -> dict[str, Any]:
    return PolicyRepository(database(request)).get(policy_pk)


@router.post("/policies", status_code=201)
def create_policy(payload: PolicyIn, request: Request, user: dict[str, Any] = Depends(require_admin)) -> Any:
    try:
        return PolicyRepository(database(request)).create(payload.model_dump(exclude_none=True), user=user["username"])
    except PolicyValidationError as exc:
        return _invalid(request, exc)


@router.put("/policies/{policy_pk}")
def update_policy(policy_pk: int, payload: PolicyIn, request: Request, user: dict[str, Any] = Depends(require_admin)) -> Any:
    try:
        return PolicyRepository(database(request)).update(policy_pk, payload.model_dump(exclude_none=True), user=user["username"])
    except PolicyValidationError as exc:
        return _invalid(request, exc)


@router.post("/policies/publish")
def publish_policies(request: Request, payload: PublishRequest | None = None, user: dict[str, Any] = Depends(require_admin)) -> dict[str, Any]:
    runner = need(request, "job_runner")
    published = PolicyRepository(database(request)).publish(payload.ids if payload else None, user=user["username"])
    job = runner.submit("reindex_policies", {"policy_ids": [item["id"] for item in published]}, created_by=user["username"])
    return {"job_id": job["id"], "published": published}
