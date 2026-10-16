from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Sequence

import numpy as np
from PIL import Image

from shopmind.core.config import load_app_config
from shopmind.domain.product import Product
from shopmind.infrastructure.embedding.base import EmbeddingProvider
from shopmind.infrastructure.embedding.siglip2 import SigLIP2EmbeddingProvider
from shopmind.ingestion.document_builder import build_search_text
from shopmind.ingestion.embedding_artifacts import EmbeddingManifest, write_embedding_artifacts


def _read_processed(path: Path, limit: int | None) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        value = json.loads(line)
        if not isinstance(value, dict):
            raise ValueError(f"{path}:{line_number} must be a JSON object")
        records.append(value)
        if limit is not None and len(records) >= limit:
            break
    return records


def _product_from_record(record: dict[str, Any]) -> Product:
    return Product(
        product_id=str(record["product_id"]),
        title=str(record.get("title") or ""),
        description=str(record.get("description") or ""),
        brand=record.get("brand"),
        category=record.get("category"),
        attributes={str(k): str(v) for k, v in (record.get("attributes") or {}).items()},
        image_paths=tuple(str(value) for value in (record.get("image_paths") or [])),
        metadata=dict(record.get("metadata") or {}),
    )


def _batches(values: Sequence[Any], size: int) -> Iterable[Sequence[Any]]:
    if size <= 0:
        raise ValueError("batch_size must be positive")
    for start in range(0, len(values), size):
        yield values[start : start + size]


def _embed_texts(provider: EmbeddingProvider, texts: list[str], batch_size: int) -> np.ndarray:
    if not texts:
        return np.empty((0, provider.dimension), dtype=np.float32)
    batches = [provider.embed_texts(batch) for batch in _batches(texts, batch_size)]
    return np.concatenate(batches, axis=0).astype(np.float32, copy=False)


def _load_images(records: list[dict[str, Any]]) -> tuple[list[int], list[Image.Image]]:
    row_indexes: list[int] = []
    images: list[Image.Image] = []
    for row_index, record in enumerate(records):
        path_value = record.get("main_image_path")
        if not path_value:
            continue
        path = Path(str(path_value))
        try:
            with Image.open(path) as image:
                images.append(image.convert("RGB").copy())
            row_indexes.append(row_index)
        except (FileNotFoundError, OSError):
            continue
    return row_indexes, images


def _embed_images(provider: EmbeddingProvider, records: list[dict[str, Any]], batch_size: int) -> np.ndarray:
    output = np.zeros((len(records), provider.dimension), dtype=np.float32)
    row_indexes, images = _load_images(records)
    if not images:
        return output
    vectors = [provider.embed_images(batch) for batch in _batches(images, batch_size)]
    stacked = np.concatenate(vectors, axis=0).astype(np.float32, copy=False)
    if stacked.shape != (len(row_indexes), provider.dimension):
        raise ValueError("image embedding provider returned an unexpected matrix shape")
    for row_index, vector in zip(row_indexes, stacked, strict=True):
        output[row_index] = vector
    return output


def generate_embeddings(input_path: str | Path, output_dir: str | Path, provider: EmbeddingProvider, dataset_version: str, limit: int | None, batch_size: int, force: bool) -> Path:
    if limit is not None and limit < 0:
        raise ValueError("limit must be non-negative or None")
    records = _read_processed(Path(input_path), limit)
    products = [_product_from_record(record) for record in records]
    product_ids = [product.product_id for product in products]
    texts = [build_search_text(product) for product in products]
    text_embeddings = _embed_texts(provider, texts, batch_size)
    image_embeddings = _embed_images(provider, records, batch_size)
    manifest = EmbeddingManifest(model=provider.model_name, model_revision=provider.model_revision, dimension=provider.dimension, dataset_version=dataset_version, product_count=len(products), normalized=True, created_at=datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"), text_preprocessing=getattr(provider, "text_preprocessing", None), image_preprocessing=getattr(provider, "image_preprocessing", None))
    return write_embedding_artifacts(output_dir, product_ids, text_embeddings, image_embeddings, manifest, force=force)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Generate reusable SigLIP2 embedding artifacts.")
    parser.add_argument("--input", type=Path, default=Path("data/processed/products.jsonl"))
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--config", type=Path, default=Path("configs/app.yaml"))
    parser.add_argument("--dataset-version", required=True)
    parser.add_argument("--device", default="auto")
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--force", action="store_true")
    return parser


def main() -> None:
    args = build_parser().parse_args()
    config = load_app_config(args.config)
    provider = SigLIP2EmbeddingProvider(model_name=config.embedding.model_name, model_revision=config.embedding.model_revision, device=None if args.device == "auto" else args.device, hf_token=config.embedding.hf_token)
    output = generate_embeddings(input_path=args.input, output_dir=args.output_dir, provider=provider, dataset_version=args.dataset_version, limit=args.limit, batch_size=config.embedding.batch_size, force=args.force)
    print(f"wrote embedding artifacts to {output}")


if __name__ == "__main__":
    main()
