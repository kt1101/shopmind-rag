"""Shared pieces for the admin/feedback routers: error mappings, role guard, component lookups.

Imported by every platform router, so the ``register_error`` calls below run before ``main``
installs the exception handlers.
"""
from __future__ import annotations

from typing import Any

from fastapi import Depends, Request
from fastapi.responses import JSONResponse

from shopmind.application.admin.config_service import ProfileNotFound
from shopmind.infrastructure.auth import AuthNotConfigured, InvalidCredentials
from shopmind.infrastructure.db.engine import Database, DatabaseUnavailable
from shopmind.infrastructure.db.eval_runs import EvalRunNotFound
from shopmind.infrastructure.db.policies import PolicyConflict, PolicyNotFound
from shopmind.infrastructure.jobs.runner import JobNotFound, UnknownJobType
from shopmind.interfaces.http.deps import component, require_auth
from shopmind.interfaces.http.errors import register_error
from shopmind.interfaces.http import ratelimit  # noqa: F401  (registers 429 rate_limited before handlers are installed)


class Forbidden(Exception):
    """Authenticated, but the role may not perform this action."""


class PlatformUnavailable(Exception):
    """A platform component (database, job runner, auth) is not wired."""


for _exc, _status, _code in (
    (Forbidden, 403, "forbidden"),
    (InvalidCredentials, 401, "invalid_credentials"),
    (AuthNotConfigured, 503, "auth_not_configured"),
    (DatabaseUnavailable, 503, "database_unavailable"),
    (PlatformUnavailable, 503, "platform_unavailable"),
    (ProfileNotFound, 404, "profile_not_found"),
    (JobNotFound, 404, "job_not_found"),
    (UnknownJobType, 422, "unknown_job_type"),
    (PolicyNotFound, 404, "policy_not_found"),
    (PolicyConflict, 409, "policy_conflict"),
    (EvalRunNotFound, 404, "eval_run_not_found"),
):
    register_error(_exc, _status, _code)


def error_response(request: Request, status: int, code: str, message: str, details: list[dict[str, Any]] | None = None) -> JSONResponse:
    """Same body as the global handlers, plus ``error.details`` (``[{field, message}]``) for 422s."""
    error: dict[str, Any] = {"code": code, "message": message}
    if details is not None:
        error["details"] = details
    return JSONResponse(status_code=status, content={"error": error, "request_id": getattr(request.state, "request_id", "unknown")})


def require_admin(user: dict[str, Any] = Depends(require_auth)) -> dict[str, Any]:
    if user.get("role") != "admin":
        raise Forbidden("this action requires the admin role")
    return user


def need(request: Request, name: str) -> Any:
    value = component(request, name)
    if value is None:
        raise PlatformUnavailable(f"{name} is not available")
    return value


def database(request: Request) -> Database:
    return need(request, "db")
