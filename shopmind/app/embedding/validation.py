"""Shared numerical and model identity checks for artifact/index/query boundaries."""
from __future__ import annotations

from typing import Any

import numpy as np


def validate_vectors(matrix: Any, dimension: int, *, allow_zero: bool = False) -> np.ndarray:
    if dimension <= 0:
        raise ValueError("embedding dimension must be positive")
    values = np.asarray(matrix, dtype=np.float32)
    if values.ndim != 2 or values.shape[1] != dimension:
        raise ValueError(f"embedding vectors must have shape (N, {dimension})")
    norms = np.linalg.norm(values, axis=1)
    if not np.isfinite(values).all() or not np.isfinite(norms).all():
        raise ValueError("embedding vectors must be finite")
    if not allow_zero and np.any(norms <= 1e-12):
        raise ValueError("embedding vectors must have nonzero norm")
    return values


def embedding_identity(value: Any, modality: str = "text") -> dict[str, Any]:
    preprocessing = getattr(value, f"{modality}_preprocessing", None)
    revision = getattr(value, "model_revision", None)
    if not revision or not preprocessing:
        raise ValueError(f"verified model revision and {modality} preprocessing identity are required")
    return {"model": getattr(value, "model_name", None) or value.model, "model_revision": revision,
            "dimension": value.dimension, "normalized": getattr(value, "normalized", True),
            "preprocessing": preprocessing}


def index_embedding_metadata(manifest: Any, *, image: bool = False) -> dict[str, Any]:
    result = {"text_vector": embedding_identity(manifest)}
    if image:
        result["image_vector"] = embedding_identity(manifest, "image")
    return {"embedding_identity": result}


def validate_index_identity(client: Any, index: str, expected: dict[str, Any], field: str) -> str:
    """Resolve exactly one physical index, validate it, then query that same index."""
    mappings = client.indices.get_mapping(index=index)
    if len(mappings) != 1:
        raise ValueError("embedding queries require exactly one concrete index")
    concrete, entry = next(iter(mappings.items()))
    mapping = entry["mappings"]
    actual = mapping.get("_meta", {}).get("embedding_identity", {}).get(field)
    if actual != expected or mapping["properties"][field]["dims"] != expected["dimension"]:
        raise ValueError(f"incompatible embedding identity for {concrete}/{field}")
    return concrete
