from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request

from shopmind.interfaces.http.deps import component
from shopmind.interfaces.http.errors import EmbeddingUnavailable, SearchInfrastructureError

router = APIRouter(tags=["health"])


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


def _components(request: Request) -> dict[str, str]:
    """Best-effort status of each dependency (never raises)."""
    status: dict[str, str] = {}
    repository = component(request, "repository")
    try:
        status["elasticsearch"] = "ok" if repository is not None and repository.ping() else "error"
    except Exception:
        status["elasticsearch"] = "error"
    embedders = component(request, "embedders") or {}
    field_embedders = component(request, "field_embedders") or {}
    image_id, text_id = field_embedders.get("image_vector"), field_embedders.get("text_vector")
    embedder = component(request, "embedder")
    status["embedder"] = "ok" if (embedders.get(image_id) or embedder) is not None and bool(getattr(embedders.get(image_id) or embedder, "is_ready", False)) else "error"
    status["text_embedder"] = "ok" if text_id and bool(getattr(embedders.get(text_id), "is_ready", False)) else ("ok" if embedder is not None and getattr(embedder, "is_ready", False) else "error")
    rag = component(request, "rag_service")
    status["llm"] = "ok" if rag is not None and getattr(rag, "llm", None) is not None else "disabled"
    for source, value in (component(request, "knowledge_status") or {}).items():
        status[source] = value
    database = component(request, "db")
    try:
        status["database"] = database.status() if database is not None and hasattr(database, "status") else "disabled"
    except Exception:
        status["database"] = "error"
    return status


@router.get("/ready")
def ready(request: Request) -> dict[str, Any]:
    if getattr(request.app.state, "runtime_error", None) is not None:
        raise SearchInfrastructureError("runtime dependencies failed to initialize")
    repository = component(request, "repository")
    embedder = component(request, "embedder")
    alias = getattr(request.app.state, "index_alias", "products")
    if repository is None:
        raise SearchInfrastructureError("search repository is not configured")
    try:
        if not repository.ping() or not repository.alias_exists(alias):
            raise SearchInfrastructureError("search repository is not ready")
    except SearchInfrastructureError:
        raise
    except Exception as exc:
        raise SearchInfrastructureError("search repository readiness check failed") from exc
    if embedder is None or not bool(getattr(embedder, "is_ready", False)):
        raise EmbeddingUnavailable("embedding provider is not ready")
    return {"status": "ready", "components": _components(request)}
