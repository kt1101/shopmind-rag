"""Run real SigLIP2 batch padding probes and write the actual vectors and identities."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import torch

from shopmind.app.core.config import load_app_config
from shopmind.app.embedding.siglip2 import SigLIP2EmbeddingProvider
from shopmind.app.embedding.validation import embedding_identity

PROBES = ["shoe", "black running shoes for walking outdoors with comfortable lightweight soles", "giày chạy bộ màu đen", "áo khoác đỏ", "B07PH3GSND", "shoe!? / black-blue (size 42)"]


def diagnose(provider):
    rows = []
    companion = "A long product description of furniture and footwear materials sizes colors and everyday features. " * 12
    for text in PROBES:
        row = {"text": text}
        for padding in ("longest", "max_length"):
            vectors = []
            for batch in ([text], [text, companion]):
                inputs = provider.processor(text=batch, padding=padding, max_length=64, truncation=True, return_tensors="pt")
                with torch.inference_mode():
                    features = provider.model.get_text_features(**provider._to_device(inputs))
                vectors.append(provider._normalize_numpy(features)[0])
            row[padding] = {"cosine": float(np.dot(*vectors)), "l2": float(np.linalg.norm(vectors[0]-vectors[1])), "standalone": vectors[0].tolist(), "mixed": vectors[1].tolist()}
        rows.append(row)
    return {"identity": embedding_identity(provider), "probes": rows, "fixed_min_cosine": min(row["max_length"]["cosine"] for row in rows)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=Path("configs/app.yaml"))
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--device", default="cpu")
    args = parser.parse_args()
    config = load_app_config(args.config)
    provider = SigLIP2EmbeddingProvider(config.embedding.model_name, config.embedding.model_revision, device=args.device, hf_token=config.embedding.hf_token)
    result = diagnose(provider)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2)+"\n")
    print(json.dumps({"output": str(args.output), "fixed_min_cosine": result["fixed_min_cosine"]}))
    if result["fixed_min_cosine"] < .99999:
        raise RuntimeError("fixed padding failed batch invariance")


if __name__ == "__main__":
    main()
