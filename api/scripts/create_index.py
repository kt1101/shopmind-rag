from __future__ import annotations

import argparse
import json
from pathlib import Path

from shopmind.app.core.config import load_app_config
from shopmind.app.embedding.validation import index_embedding_metadata
from shopmind.app.infrastructure.elasticsearch.client import create_elasticsearch_client
from shopmind.app.infrastructure.elasticsearch.index import create_versioned_index
from shopmind.pipeline.embedding_artifacts import EmbeddingManifest


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
    return parser


def main() -> None:
    args = build_parser().parse_args()
    config = load_app_config(args.config)
    manifest_path = args.manifest if args.manifest is not None else args.artifacts_dir / "manifest.json"
    manifest = _read_manifest(manifest_path)
    client = create_elasticsearch_client(config.elasticsearch)
    create_versioned_index(client, args.index_name, manifest.dimension, recreate=args.recreate, embedding_metadata=index_embedding_metadata(manifest, image=True))
    print(f"created {args.index_name} with dimension {manifest.dimension}")


if __name__ == "__main__":
    main()
