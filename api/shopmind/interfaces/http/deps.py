"""Shared FastAPI dependencies: components from the container, config, auth, tracing."""
from __future__ import annotations

from collections.abc import Iterator, Mapping
from contextlib import contextmanager
from typing import Any

from fastapi import Request

from shopmind.core.config import AppConfig
from shopmind.core.tracing import PipelineTrace, start_trace
from shopmind.interfaces.http.errors import NotAuthenticated, SearchInfrastructureError


def get_config(request: Request) -> AppConfig:
    """Effective config, including runtime (admin) overrides when a config service is wired."""
    service = component(request, "config_service")
    if service is not None:
        return service.effective()
    return request.app.state.config


def component(request: Request, name: str, default: Any = None) -> Any:
    container = getattr(request.app.state, "container", None)
    if container is not None and container.get(name) is not None:
        return container.get(name)
    return getattr(request.app.state, name, default)


def require_component(request: Request, name: str, message: str | None = None) -> Any:
    value = component(request, name)
    if value is None:
        raise SearchInfrastructureError(message or f"{name} is not ready")
    return value


def require_auth(request: Request) -> dict[str, Any]:
    """Bearer-token guard for admin/debug/trace endpoints (no-op when ``auth.enabled`` is false).

    The ``auth_service`` component must expose ``verify(token) -> dict`` raising on invalid tokens.
    """
    config = request.app.state.config
    if config is None or not config.auth.enabled:
        return {"username": "anonymous", "role": "admin"}
    header = request.headers.get("authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise NotAuthenticated("missing bearer token")
    service = component(request, "auth_service")
    if service is None:
        raise NotAuthenticated("authentication is not configured")
    try:
        return service.verify(token)
    except Exception as exc:
        raise NotAuthenticated("invalid or expired token") from exc


def wants_explain(request: Request, explicit: bool | None = None) -> bool:
    if explicit:
        return True
    return request.query_params.get("explain", "").lower() in {"1", "true", "yes"}


@contextmanager
def traced(request: Request, pipeline: str, *, kind: str, input: Mapping[str, Any] | None = None, verbose: bool = False, persist: bool = True) -> Iterator[PipelineTrace]:
    """Run a request inside a glass-box trace and persist it to the trace store afterwards.

    ``trace_id`` equals the request id so the UI can fetch it later via ``GET /api/v1/traces/{id}``.
    """
    config = request.app.state.config
    max_items = config.tracing.max_items_per_step if config is not None else 20
    trace_id = getattr(request.state, "request_id", None) or "unknown"
    with start_trace(pipeline, kind=kind, trace_id=trace_id, input=input, max_items=max_items, verbose=verbose) as trace:
        yield trace
    if persist:
        save_trace(request, trace)


def save_trace(request: Request, trace: PipelineTrace) -> None:
    """Persist a finished trace (no-op when tracing is disabled; never raises)."""
    config = request.app.state.config
    if config is None or config.tracing.enabled:
        store = component(request, "trace_store")
        if store is not None:
            try:
                store.save(trace.to_dict())
            except Exception:  # tracing must never break the user-facing request
                import logging

                logging.getLogger("shopmind.tracing").warning("trace persistence failed", exc_info=True)
