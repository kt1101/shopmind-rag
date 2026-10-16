from __future__ import annotations

from fastapi import APIRouter, Request

from shopmind.app.api.errors import EmbeddingUnavailable, SearchInfrastructureError

router = APIRouter(tags=["health"])


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/ready")
def ready(request: Request) -> dict[str, str]:
    if getattr(request.app.state, "runtime_error", None) is not None:
        raise SearchInfrastructureError("runtime dependencies failed to initialize")
    repository = getattr(request.app.state, "repository", None)
    embedder = getattr(request.app.state, "embedder", None)
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
    return {"status": "ready"}
