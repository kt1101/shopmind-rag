"""Build the 2D embedding map (glass-box): PCA projections of the product embedding spaces.

Writes ``<output>/<space>.json`` for each available space:

- ``text``         dedicated text embedder (E5) product vectors
- ``siglip_text``  SigLIP2 text vectors (the old dense space; shows why it underperformed)
- ``image``        SigLIP2 image vectors

Each file holds the 2D points plus the PCA mean/components, so the API can project a live query
into the same plane (``POST /api/v1/meta/embedding-map/project``). PCA is computed with NumPy
(SVD); no vectors are written beyond the 2 principal axes.

    python -m scripts.build_embedding_map --output data/embedding_map
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import numpy as np

from shopmind.ingestion.embedding_artifacts import load_embedding_artifacts

DEFAULTS = {"products": "data/a1_abo_1500/products.jsonl", "siglip": "data/embeddings/abo_a1_1500_v1", "text": "data/embeddings/abo_a1_1500_v1_text_e5"}


def pca_2d(matrix: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray, list[float]]:
    """(coordinates (N, 2), mean (D,), components (2, D), explained variance ratio)."""
    values = np.asarray(matrix, dtype=np.float64)
    mean = values.mean(axis=0)
    centered = values - mean
    _, singular, vt = np.linalg.svd(centered, full_matrices=False)
    components = vt[:2]
    variance = singular ** 2
    ratio = (variance[:2] / variance.sum()).tolist() if variance.sum() > 0 else [0.0, 0.0]
    return centered @ components.T, mean, components, ratio


def build_space(space: str, ids: list[str], matrix: np.ndarray, products: dict[str, dict[str, Any]], *, embedder: str, model: str) -> dict[str, Any]:
    keep = [index for index, row in enumerate(matrix) if float(np.linalg.norm(row)) > 1e-6]
    coords, mean, components, ratio = pca_2d(matrix[keep])
    points = []
    for row, index in zip(coords, keep, strict=True):
        product = products.get(ids[index], {})
        points.append({"product_id": ids[index], "x": round(float(row[0]), 5), "y": round(float(row[1]), 5), "category": product.get("category"), "title": product.get("title")})
    return {"space": space, "projection": "pca", "embedder": embedder, "model": model, "dims": int(matrix.shape[1]), "explained_variance": [round(value, 4) for value in ratio], "points": points, "pca": {"mean": [round(float(v), 7) for v in mean], "components": [[round(float(v), 7) for v in component] for component in components]}}


def main() -> None:
    parser = argparse.ArgumentParser(description="Build 2D PCA embedding maps for the glass-box UI.")
    parser.add_argument("--products", type=Path, default=Path(DEFAULTS["products"]))
    parser.add_argument("--siglip-embeddings", type=Path, default=Path(DEFAULTS["siglip"]))
    parser.add_argument("--text-embeddings", type=Path, default=Path(DEFAULTS["text"]))
    parser.add_argument("--output", type=Path, default=Path("data/embedding_map"))
    args = parser.parse_args()
    products = {}
    for line in args.products.read_text(encoding="utf-8").splitlines():
        if line.strip():
            row = json.loads(line)
            products[str(row["product_id"])] = {"category": row.get("category"), "title": row.get("title")}
    args.output.mkdir(parents=True, exist_ok=True)
    spaces: dict[str, dict[str, Any]] = {}
    manifest, ids, text, image = load_embedding_artifacts(args.siglip_embeddings)
    spaces["siglip_text"] = build_space("siglip_text", ids, text, products, embedder=manifest.embedder_id or "siglip2", model=manifest.model)
    if image is not None:
        spaces["image"] = build_space("image", ids, image, products, embedder=manifest.embedder_id or "siglip2", model=manifest.model)
    if args.text_embeddings.exists():
        text_manifest, text_ids, text_matrix, _ = load_embedding_artifacts(args.text_embeddings)
        spaces["text"] = build_space("text", text_ids, text_matrix, products, embedder=text_manifest.embedder_id or "text", model=text_manifest.model)
    for space, payload in spaces.items():
        (args.output / f"{space}.json").write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        print(f"wrote {args.output / f'{space}.json'} ({len(payload['points'])} points, explained variance {payload['explained_variance']})")


if __name__ == "__main__":
    main()
