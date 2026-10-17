from __future__ import annotations

import json
import shutil
import tempfile
import uuid
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import numpy as np


@dataclass(frozen=True)
class EmbeddingManifest:
    model: str
    model_revision: str | None
    dimension: int
    dataset_version: str
    product_count: int
    normalized: bool
    created_at: str
    text_preprocessing: dict[str, Any] | None = None
    image_preprocessing: dict[str, Any] | None = None
    # Config id of the embedder (``embedders.<id>``). Text-only embedders (E5/BGE) write no
    # image_embeddings.npy and leave image_preprocessing empty.
    embedder_id: str | None = None

    @property
    def has_images(self) -> bool:
        return self.image_preprocessing is not None

    def __post_init__(self) -> None:
        if self.dimension <= 0:
            raise ValueError("dimension must be positive")
        if self.product_count < 0:
            raise ValueError("product_count must be non-negative")
        if not self.model.strip():
            raise ValueError("model must not be blank")
        if not self.dataset_version.strip():
            raise ValueError("dataset_version must not be blank")

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> "EmbeddingManifest":
        return cls(**value)


def _load_product_ids(directory: Path) -> list[str]:
    value = json.loads((directory / "product_ids.json").read_text(encoding="utf-8"))
    if not isinstance(value, list) or not all(isinstance(item, str) and item for item in value):
        raise ValueError("product_ids.json must contain a list of non-empty strings")
    return value


def _load_matrix(path: Path) -> np.ndarray:
    matrix = np.load(path, allow_pickle=False)
    if matrix.ndim != 2:
        raise ValueError(f"{path.name} must be a 2D matrix")
    return matrix


def _validate_normalized(matrix: np.ndarray, *, allow_zero_rows: bool, name: str) -> None:
    if matrix.shape[0] == 0:
        return
    norms = np.linalg.norm(matrix, axis=1)
    if allow_zero_rows:
        valid = np.isclose(norms, 0.0, atol=1e-6) | np.isclose(norms, 1.0, atol=1e-4)
    else:
        valid = np.isclose(norms, 1.0, atol=1e-4)
    if not bool(np.all(valid)):
        raise ValueError(f"{name} contains vectors that are not unit-normalized")


def validate_artifacts(directory: str | Path, manifest: EmbeddingManifest) -> None:
    directory = Path(directory)
    product_ids = _load_product_ids(directory)
    text = _load_matrix(directory / "text_embeddings.npy")
    image_path = directory / "image_embeddings.npy"
    if not image_path.exists() and not manifest.has_images:
        image = np.zeros((manifest.product_count, manifest.dimension), dtype=np.float32)
    else:
        image = _load_matrix(image_path)
    if len(set(product_ids)) != len(product_ids):
        raise ValueError("product IDs must be unique")
    if len(product_ids) != manifest.product_count:
        raise ValueError(f"product ID count {len(product_ids)} does not match manifest product_count {manifest.product_count}")
    if text.shape[0] != manifest.product_count or image.shape[0] != manifest.product_count:
        raise ValueError("embedding row count does not match manifest product_count")
    if text.shape[1] != manifest.dimension or image.shape[1] != manifest.dimension:
        raise ValueError("embedding dimension does not match manifest dimension")
    if text.dtype != np.float32 or image.dtype != np.float32:
        raise ValueError("embedding matrices must use float32 dtype")
    if not np.isfinite(text).all() or not np.isfinite(image).all():
        raise ValueError("embedding matrices must not contain NaN or Inf")
    from shopmind.infrastructure.embedding.validation import validate_vectors
    validate_vectors(text, manifest.dimension)
    validate_vectors(image, manifest.dimension, allow_zero=True)
    if manifest.normalized:
        _validate_normalized(text, allow_zero_rows=False, name="text_embeddings")
        _validate_normalized(image, allow_zero_rows=True, name="image_embeddings")


def write_embedding_artifacts(output_dir: str | Path, product_ids: list[str], text_embeddings: np.ndarray, image_embeddings: np.ndarray | None, manifest: EmbeddingManifest, *, force: bool = False) -> Path:
    output_dir = Path(output_dir)
    output_dir.parent.mkdir(parents=True, exist_ok=True)
    if output_dir.exists() and not force:
        raise FileExistsError(f"artifact directory already exists: {output_dir}; use force=True to replace it")
    temp_dir = Path(tempfile.mkdtemp(prefix=f".{output_dir.name}.", dir=output_dir.parent))
    backup_dir: Path | None = None
    try:
        (temp_dir / "product_ids.json").write_text(json.dumps(product_ids, ensure_ascii=False), encoding="utf-8")
        np.save(temp_dir / "text_embeddings.npy", np.asarray(text_embeddings, dtype=np.float32))
        if image_embeddings is not None:
            np.save(temp_dir / "image_embeddings.npy", np.asarray(image_embeddings, dtype=np.float32))
        validate_artifacts(temp_dir, manifest)
        (temp_dir / "manifest.json").write_text(json.dumps(manifest.to_dict(), ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        if output_dir.exists():
            backup_dir = output_dir.with_name(f".{output_dir.name}.backup-{uuid.uuid4().hex}")
            output_dir.replace(backup_dir)
        temp_dir.replace(output_dir)
        temp_dir = output_dir
        if backup_dir is not None:
            shutil.rmtree(backup_dir)
            backup_dir = None
    except Exception:
        if backup_dir is not None and backup_dir.exists() and not output_dir.exists():
            backup_dir.replace(output_dir)
            backup_dir = None
        if temp_dir.exists() and temp_dir != output_dir:
            shutil.rmtree(temp_dir, ignore_errors=True)
        raise
    return output_dir


def load_embedding_artifacts(directory: str | Path) -> tuple[EmbeddingManifest, list[str], np.ndarray, np.ndarray | None]:
    """Manifest, product ids, text matrix and image matrix (``None`` for text-only embedders)."""
    directory = Path(directory)
    manifest_path = directory / "manifest.json"
    if not manifest_path.exists():
        raise FileNotFoundError(f"artifact manifest is missing: {manifest_path}")
    raw_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if not isinstance(raw_manifest, dict):
        raise ValueError("manifest.json must contain a JSON object")
    manifest = EmbeddingManifest.from_dict(raw_manifest)
    validate_artifacts(directory, manifest)
    image_path = directory / "image_embeddings.npy"
    image = _load_matrix(image_path) if image_path.exists() else None
    return manifest, _load_product_ids(directory), _load_matrix(directory / "text_embeddings.npy"), image
