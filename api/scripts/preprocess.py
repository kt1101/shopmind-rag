from __future__ import annotations

import argparse
import json
import os
import tempfile
from pathlib import Path

from shopmind.pipeline.document_builder import product_to_processed_record
from shopmind.pipeline.normalizer import normalize_abo_record
from shopmind.pipeline.subset import select_balanced_subset


def _load_jsonl(path: Path) -> list[dict]:
    records: list[dict] = []
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        value = json.loads(line)
        if not isinstance(value, dict):
            raise ValueError(f"{path}:{line_number} must contain a JSON object")
        records.append(value)
    return records


def preprocess(input_path: Path, image_map_path: Path, output_path: Path, limit: int, seed: int) -> int:
    image_lookup = json.loads(image_map_path.read_text(encoding="utf-8"))
    if not isinstance(image_lookup, dict):
        raise ValueError("image map must be a JSON object")
    products = [normalize_abo_record(record, image_lookup) for record in _load_jsonl(input_path)]
    selected = select_balanced_subset(products, limit=limit, seed=seed)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=f".{output_path.name}.", suffix=".tmp", dir=output_path.parent)
    temp_path = Path(temp_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            for product in selected:
                handle.write(json.dumps(product_to_processed_record(product), ensure_ascii=False, sort_keys=True))
                handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        temp_path.replace(output_path)
    except Exception:
        temp_path.unlink(missing_ok=True)
        raise
    return len(selected)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Normalize and select a deterministic ABO product subset.")
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--image-map", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--limit", type=int, default=8000)
    parser.add_argument("--seed", type=int, default=42)
    return parser


def main() -> None:
    args = build_parser().parse_args()
    count = preprocess(args.input, args.image_map, args.output, args.limit, args.seed)
    print(f"wrote {count} products to {args.output}")


if __name__ == "__main__":
    main()
