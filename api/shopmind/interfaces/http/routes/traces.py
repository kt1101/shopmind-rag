from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from shopmind.core.registry import available
from shopmind.interfaces.http.deps import component, get_config, require_auth, require_component
from shopmind.interfaces.http.errors import TraceNotFound

router = APIRouter(prefix="/api/v1", tags=["glass-box"])


@router.get("/traces/{trace_id}", dependencies=[Depends(require_auth)])
def get_trace(trace_id: str, request: Request) -> dict:
    trace = require_component(request, "trace_store", "trace store is not ready").get(trace_id)
    if trace is None:
        raise TraceNotFound(f"trace {trace_id} not found")
    return trace


@router.get("/meta/pipelines")
def list_pipelines(request: Request, include_hidden: bool = False) -> dict:
    config = get_config(request)
    factory = component(request, "pipelines")
    pipelines = []
    for name, spec in config.pipelines.items():
        if not spec.public and not include_hidden:
            continue
        pipelines.append({"name": name, "kind": spec.kind, "description": spec.description, "public": spec.public, "steps": [{"id": step.key, "step": step.step, "impl": step.impl, "enabled": step.enabled} for step in spec.steps]})
    del factory
    return {"pipelines": pipelines, "defaults": dict(config.defaults), "components": available()}
