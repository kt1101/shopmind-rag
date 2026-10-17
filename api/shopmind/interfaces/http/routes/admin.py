"""Admin console API (docs/API_CONTRACT.md "Admin (JWT)"): auth, stats, config, traces, indexes,
feedback and eval runs. Jobs + policies live in ``admin_jobs``, annotation in ``admin_judgments``.
"""
from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field

from shopmind.application.admin.config_service import ConfigService, ConfigValidationError
from shopmind.infrastructure.db.eval_runs import EvalRunRepository
from shopmind.infrastructure.db.trace_store import input_summary
from shopmind.interfaces.http.admin_support import database, error_response, need, require_admin
from shopmind.interfaces.http.deps import component, get_config, require_auth

logger = logging.getLogger("shopmind.admin")

router = APIRouter(prefix="/api/v1/admin", tags=["admin"])
guarded = [Depends(require_auth)]


# -- auth ---------------------------------------------------------------------------------------
class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=256)


@router.post("/auth/login")
def login(payload: LoginRequest, request: Request) -> dict[str, Any]:
    return need(request, "auth_service").login(payload.username.strip(), payload.password)


@router.get("/auth/me")
def me(user: dict[str, Any] = Depends(require_auth)) -> dict[str, Any]:
    return {"username": user["username"], "role": user["role"]}


# -- dashboard ----------------------------------------------------------------------------------
@router.get("/stats", dependencies=guarded)
def stats(request: Request, days: int = Query(7, ge=1, le=90)) -> dict[str, Any]:
    return {**need(request, "event_log").stats(days), "days": days}


# -- config -------------------------------------------------------------------------------------
class ConfigUpdate(BaseModel):
    name: str = Field(default="", max_length=128)
    overrides: dict[str, Any] = Field(default_factory=dict)


def _profile_summary(profile: dict[str, Any] | None) -> dict[str, Any]:
    if not profile:
        return {"id": None, "name": "base", "created_at": None, "created_by": None}
    return {key: profile.get(key) for key in ("id", "name", "created_at", "created_by")}


def _config_payload(service: ConfigService) -> dict[str, Any]:
    config = service.effective()
    return {
        "effective": service.redacted(config),
        "hot_reloadable": service.hot_reloadable_keys(config),
        "hot_reloadable_patterns": service.patterns,
        "hot_reloadable_specs": service.hot_reloadable_specs(config),
        "active_profile": _profile_summary(service.active_profile()),
    }


@router.get("/config", dependencies=guarded)
def get_effective_config(request: Request) -> dict[str, Any]:
    return _config_payload(need(request, "config_service"))


@router.put("/config")
def save_config(payload: ConfigUpdate, request: Request, user: dict[str, Any] = Depends(require_admin)) -> Any:
    service: ConfigService = need(request, "config_service")
    try:
        profile = service.save_profile(payload.name, payload.overrides, user["username"])
    except ConfigValidationError as exc:
        return error_response(request, 422, "validation_error", "; ".join(f"{item['field']}: {item['message']}" for item in exc.details) or str(exc), exc.details)
    return {"profile": profile, "effective": service.redacted()}


@router.get("/config/profiles", dependencies=guarded)
def list_profiles(request: Request) -> dict[str, Any]:
    service: ConfigService = need(request, "config_service")
    service.ensure_baseline()
    return {"items": service.list_profiles()}


@router.post("/config/profiles/{profile_id}/activate", dependencies=[Depends(require_admin)])
def activate_profile(profile_id: int, request: Request) -> Any:
    service: ConfigService = need(request, "config_service")
    try:
        profile = service.activate(profile_id)
    except ConfigValidationError as exc:
        return error_response(request, 422, "validation_error", "profile is not valid for the current base config", exc.details)
    return {"profile": profile, "effective": service.redacted()}


# -- traces -------------------------------------------------------------------------------------
@router.get("/traces", dependencies=guarded)
def list_traces(request: Request, q: str | None = Query(None, max_length=200), kind: str | None = Query(None, max_length=32), limit: int = Query(20, ge=1, le=200), offset: int = Query(0, ge=0)) -> dict[str, Any]:
    total, traces = need(request, "trace_store").list(q=q or None, kind=kind or None, limit=limit, offset=offset)
    items = [{"trace_id": trace.get("trace_id"), "kind": trace.get("kind"), "pipeline": trace.get("pipeline"), "created_at": trace.get("created_at"), "duration_ms": trace.get("duration_ms"), "input_summary": input_summary(trace)} for trace in traces]
    return {"total": total, "items": items}


# -- indexes ------------------------------------------------------------------------------------
def _embedder_id(identity: dict[str, Any]) -> str:
    model = str(identity.get("model") or "unknown")
    revision = str(identity.get("model_revision") or "")
    return f"{model.rsplit('/', 1)[-1]}@{revision[:7]}" if revision else model.rsplit("/", 1)[-1]


def _describe_index(client: Any, name: str, alias: str, configured: dict[str, str]) -> dict[str, Any]:
    item: dict[str, Any] = {"name": name, "alias": alias, "index": None, "indices": [], "doc_count": None, "vector_fields": {}, "embedder_ids": [], "configured_embedders": configured, "status": "unavailable"}
    if client is None:
        return item
    try:
        if not client.indices.exists_alias(name=alias):
            item["status"] = "missing"
            return item
        indices = sorted(client.indices.get_alias(name=alias).keys())
        item["indices"] = indices
        item["index"] = indices[0] if len(indices) == 1 else ", ".join(indices)
        item["doc_count"] = int(client.count(index=alias)["count"])
        embedders: list[str] = []
        for entry in client.indices.get_mapping(index=alias).values():
            mapping = entry.get("mappings", {})
            for field, spec in (mapping.get("properties") or {}).items():
                if spec.get("type") == "dense_vector":
                    item["vector_fields"][field] = spec.get("dims")
            for identity in ((mapping.get("_meta") or {}).get("embedding_identity") or {}).values():
                if isinstance(identity, dict) and (embedder := _embedder_id(identity)) not in embedders:
                    embedders.append(embedder)
        item["embedder_ids"] = embedders or sorted(set(configured.values()))
        item["status"] = "ok"
    except Exception as exc:
        logger.warning("index %s inspection failed: %s", alias, exc)
        item["status"] = "unavailable"
        item["error"] = type(exc).__name__
    return item


@router.get("/indexes", dependencies=guarded)
def list_indexes(request: Request) -> dict[str, Any]:
    config = get_config(request)
    client = component(request, "es_client")
    return {"items": [_describe_index(client, name, spec.alias, dict(spec.vectors)) for name, spec in config.indexes.items()]}


# -- feedback -----------------------------------------------------------------------------------
@router.get("/feedback", dependencies=guarded)
def list_feedback(request: Request, limit: int = Query(20, ge=1, le=200), offset: int = Query(0, ge=0), rating: int | None = Query(None), target: str | None = Query(None, max_length=16)) -> dict[str, Any]:
    total, items = need(request, "event_log").list_feedback(limit=limit, offset=offset, rating=rating if rating in (1, -1) else None, target=target or None)
    return {"total": total, "items": items}


# -- eval runs ----------------------------------------------------------------------------------
@router.get("/eval-runs", dependencies=guarded)
def list_eval_runs(request: Request, kind: str | None = Query(None, pattern="^(a1|a3)$")) -> dict[str, Any]:
    return {"items": EvalRunRepository(database(request)).list(kind=kind)}


@router.get("/eval-runs/{run_id}", dependencies=guarded)
def get_eval_run(run_id: int, request: Request) -> dict[str, Any]:
    return EvalRunRepository(database(request)).get(run_id)


@router.post("/eval-runs/import", dependencies=[Depends(require_admin)])
def import_eval_runs(request: Request) -> dict[str, Any]:
    config = get_config(request)
    imported = EvalRunRepository(database(request)).import_dir(config.jobs.runs_dir)
    return {"imported": len(imported), "ids": imported}
