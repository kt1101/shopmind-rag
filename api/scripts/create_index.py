from __future__ import annotations

import argparse
import json
from pathlib import Path

from shopmind.core.config import load_app_config
from shopmind.infrastructure.embedding.validation import field_embedding_metadata
from shopmind.infrastructure.elasticsearch.client import create_elasticsearch_client
from shopmind.infrastructure.elasticsearch.index import create_versioned_index
from shopmind.ingestion.embedding_artifacts import EmbeddingManifest


def _read_manifest(path: Path) -> EmbeddingManifest:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("manifest must be a JSON object")
    return EmbeddingManifest.from_dict(value)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Create a versioned Elasticsearch product index.")
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--artifacts-dir", type=Path)
    source.add_argument("--manifest", type=Path)
    parser.add_argument("--index-name", required=True)
    parser.add_argument("--config", type=Path, default=Path("configs/app.yaml"))
    parser.add_argument("--recreate", action="store_true")
    parser.add_argument("--text-manifest", type=Path, default=None, help="manifest of a dedicated text embedder (E5/BGE) that fills text_vector; the SigLIP2 text space then moves to siglip_text_vector")
    return parser


def product_index_layout(manifest: EmbeddingManifest, text_manifest: EmbeddingManifest | None = None) -> tuple[dict[str, int], dict]:
    """Vector field dims + per-field embedding identities for the products index."""
    if text_manifest is None:
        return {"text_vector": manifest.dimension, "image_vector": manifest.dimension}, field_embedding_metadata({"text_vector": (manifest, "text"), "image_vector": (manifest, "image")})
    dims = {"text_vector": text_manifest.dimension, "image_vector": manifest.dimension, "siglip_text_vector": manifest.dimension}
    return dims, field_embedding_metadata({"text_vector": (text_manifest, "text"), "image_vector": (manifest, "image"), "siglip_text_vector": (manifest, "text")})


def main() -> None:
    args = build_parser().parse_args()
    config = load_app_config(args.config)
    manifest_path = args.manifest if args.manifest is not None else args.artifacts_dir / "manifest.json"
    manifest = _read_manifest(manifest_path)
    text_manifest = _read_manifest(args.text_manifest) if args.text_manifest else None
    dims, metadata = product_index_layout(manifest, text_manifest)
    client = create_elasticsearch_client(config.elasticsearch)
    extra = {field: size for field, size in dims.items() if field not in {"text_vector", "image_vector"}}
    create_versioned_index(client, args.index_name, manifest.dimension, recreate=args.recreate, embedding_metadata=metadata, text_dimension=dims["text_vector"], extra_vectors=extra)
    print(f"created {args.index_name} with vector dims {dims}")


if __name__ == "__main__":
    main()
