"""Embedding map (glass-box): 2D PCA of each product embedding space + live query projection."""
from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import Any, Literal

import numpy as np
from fastapi import APIRouter, Query, Request
from pydantic import BaseModel, Field

from shopmind.infrastructure.embedding.factory import embed_query
from shopmind.interfaces.http.deps import component
from shopmind.interfaces.http.errors import SearchInfrastructureError, register_error

router = APIRouter(prefix="/api/v1/meta", tags=["glass-box"])

Space = Literal["text", "siglip_text", "image"]
# Which embedder encodes a text query for each space (image: cross-modal SigLIP2 text encoder).
_QUERY_FIELD = {"text": "text_vector", "siglip_text": "siglip_text_vector", "image": "image_vector"}
_cache: dict[str, dict[str, Any]] = {}
_lock = threading.Lock()


class EmbeddingMapNotBuilt(Exception):
    """The offline map artifact is missing (run ``make embedding-map``)."""


register_error(EmbeddingMapNotBuilt, 404, "embedding_map_not_built")


def _map_dir(request: Request) -> Path:
    config = request.app.state.config
    jobs = getattr(config, "jobs", None)
    configured = getattr(jobs, "embedding_map_output", None) if jobs is not None else None
    return Path(configured or "data/embedding_map")


def _load(request: Request, space: str) -> dict[str, Any]:
    path = _map_dir(request) / f"{space}.json"
    key = str(path.resolve())
    with _lock:
        cached = _cache.get(key)
        mtime = path.stat().st_mtime if path.exists() else None
        if cached is not None and cached.get("_mtime") == mtime:
            return cached
        if mtime is None:
            raise EmbeddingMapNotBuilt(f"embedding map for {space!r} is not built; run `python -m scripts.build_embedding_map`")
        payload = json.loads(path.read_text(encoding="utf-8"))
        payload["_mtime"] = mtime
        _cache[key] = payload
        return payload


@router.get("/embedding-map")
def embedding_map(request: Request, space: Space = Query("text")) -> dict[str, Any]:
    payload = _load(request, space)
    return {key: value for key, value in payload.items() if key not in {"pca", "_mtime"}}


class ProjectRequest(BaseModel):
    space: Space = "text"
    query: str = Field(min_length=1, max_length=300)


@router.post("/embedding-map/project")
def project(payload: ProjectRequest, request: Request) -> dict[str, Any]:
    data = _load(request, payload.space)
    field_embedders = component(request, "field_embedders") or {}
    embedders = component(request, "embedders") or {}
    embedder = embedders.get(field_embedders.get(_QUERY_FIELD[payload.space]) or data.get("embedder"))
    if embedder is None:
        raise SearchInfrastructureError(f"no embedder loaded for space {payload.space}")
    vector = np.asarray(embed_query(embedder, payload.query)[0], dtype=np.float64)
    mean = np.asarray(data["pca"]["mean"], dtype=np.float64)
    components = np.asarray(data["pca"]["components"], dtype=np.float64)
    if vector.shape[0] != mean.shape[0]:
        raise SearchInfrastructureError("query embedding does not match the map's dimension")
    x, y = (vector - mean) @ components.T
    return {"space": payload.space, "query": payload.query, "x": round(float(x), 5), "y": round(float(y), 5), "projection": "pca"}
