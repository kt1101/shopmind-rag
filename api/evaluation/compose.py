"""F1 evaluation: composed image + text retrieval ("like this photo, but <colour>").

Benchmark (deterministic, built from the catalog itself): for a product A with image and a
product B of the same category but a different canonical colour, the query is A's image plus
B's colour as text (Vietnamese or English). Relevance: B = 2, other same-category products with
B's colour = 1, everything else (including A) = 0. These are synthetic labels derived from
metadata, not human judgments.

Compared modes: image-only (A's image), text-only (the colour text alone, hybrid search),
text-only with category (colour + category words), and composed search for several alphas.

    python -m evaluation.compose --products data/a1_abo_1500/products.jsonl --runs-root runs/compose
"""
from __future__ import annotations

import argparse
import json
import random
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from statistics import fmean
from typing import Any

from PIL import Image

from evaluation.metrics import mrr_at_k, ndcg_at_k, recall_at_k
from shopmind.application.retrieval.language import canonical_color, vocabulary
from shopmind.domain.search_query import SearchMode, SearchRequest

COLOR_TEXT_VI = {"black": "màu đen", "white": "màu trắng", "red": "màu đỏ", "blue": "màu xanh dương", "gray": "màu xám", "green": "màu xanh lá", "pink": "màu hồng", "beige": "màu be", "navy blue": "màu xanh hải quân", "multicolor": "nhiều màu"}


def build_compose_benchmark(products_path: Path, *, size: int = 40, seed: int = 42) -> list[dict[str, Any]]:
    rows = [json.loads(line) for line in products_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    known = set(vocabulary().colors)
    by_category: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        color = canonical_color(str((row.get("attributes") or {}).get("color") or ""))
        if color in known and row.get("main_image_path") and row.get("category"):
            by_category[row["category"]].append({**row, "_color": color})
    rng = random.Random(seed)
    candidates = []
    for category, items in sorted(by_category.items()):
        if len({item["_color"] for item in items}) < 2:
            continue
        for anchor in items:
            targets = [item for item in items if item["_color"] != anchor["_color"]]
            target = rng.choice(sorted(targets, key=lambda item: item["product_id"]))
            candidates.append((category, anchor, target))
    rng.shuffle(candidates)
    queries, used_anchors = [], set()
    for category, anchor, target in candidates:
        if anchor["product_id"] in used_anchors:
            continue
        used_anchors.add(anchor["product_id"])
        language = "vi" if len(queries) % 2 == 0 else "en"
        text = COLOR_TEXT_VI[target["_color"]] if language == "vi" else target["_color"]
        relevant = {item["product_id"]: 1 for item in by_category[category] if item["_color"] == target["_color"]}
        relevant[target["product_id"]] = 2
        queries.append({"query_id": f"c{len(queries) + 1:03d}", "anchor_id": anchor["product_id"], "image_path": anchor["main_image_path"], "text": text, "color": target["_color"], "category": category, "language": language, "target_id": target["product_id"], "qrels": relevant})
        if len(queries) >= size:
            break
    return queries


def _metrics(ranked: list[str], relevance: dict[str, int]) -> dict[str, float]:
    return {"Recall@10": recall_at_k(ranked, relevance, 10), "nDCG@10": ndcg_at_k(ranked, relevance, 10), "MRR@10": mrr_at_k(ranked, relevance, 10)}


def run_compose_evaluation(service: Any, queries: list[dict[str, Any]], runs_root: Path, *, alphas: tuple[float, ...] = (0.3, 0.5, 0.7)) -> Path:
    modes: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for query in queries:
        with Image.open(query["image_path"]) as opened:
            image = opened.convert("RGB")
        runs = {
            "image_only": lambda: service.search_image(image, top_k=10, candidate_k=100),
            "text_only": lambda: service.search_text(SearchRequest(query["text"], SearchMode.HYBRID, top_k=10, candidate_k=100)),
            "text_with_category": lambda: service.search_text(SearchRequest(f"{query['text']} {query['category'].replace('_', ' ').lower()}", SearchMode.HYBRID, top_k=10, candidate_k=100)),
            **{f"composed_alpha_{alpha}": (lambda alpha=alpha: service.search_compose(image, query["text"], alpha=alpha, top_k=10, candidate_k=100)) for alpha in alphas},
        }
        for mode, run in runs.items():
            ranked = [result.product_id for result in run()]
            modes[mode].append({"query_id": query["query_id"], "language": query["language"], "ranked": ranked, "metrics": _metrics(ranked, query["qrels"]), "target_rank": ranked.index(query["target_id"]) + 1 if query["target_id"] in ranked else None})
    now = datetime.now(timezone.utc)
    run_dir = runs_root / f"{now.strftime('%Y%m%dT%H%M%SZ')}_compose_f1"
    run_dir.mkdir(parents=True, exist_ok=True)
    summary = {}
    for mode, rows in modes.items():
        summary[mode] = {name: fmean(row["metrics"][name] for row in rows) for name in ("Recall@10", "nDCG@10", "MRR@10")}
        summary[mode]["target_hit@10"] = fmean(row["target_rank"] is not None for row in rows)
        for language in ("vi", "en"):
            subset = [row for row in rows if row["language"] == language]
            if subset:
                summary[mode][f"nDCG@10_{language}"] = fmean(row["metrics"]["nDCG@10"] for row in subset)
    metrics = {"run_id": run_dir.name, "created_at": now.isoformat().replace("+00:00", "Z"), "benchmark": {"queries": len(queries), "labels": "synthetic: same category + target colour from catalog metadata", "seed": 42}, "metrics_by_mode": summary}
    (run_dir / "metrics.json").write_text(json.dumps(metrics, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    (run_dir / "queries.jsonl").write_text("".join(json.dumps(query, ensure_ascii=False, sort_keys=True) + "\n" for query in queries), encoding="utf-8", newline="\n")
    (run_dir / "results.jsonl").write_text("".join(json.dumps({"mode": mode, **row}, ensure_ascii=False, sort_keys=True) + "\n" for mode, rows in modes.items() for row in rows), encoding="utf-8", newline="\n")
    lines = ["# F1 composed retrieval", "", f"{len(queries)} queries, synthetic labels (same category + target colour). Seed 42.", "", "| mode | Recall@10 | nDCG@10 | MRR@10 | target hit@10 |", "|---|---:|---:|---:|---:|"]
    lines += [f"| {mode} | {values['Recall@10']:.4f} | {values['nDCG@10']:.4f} | {values['MRR@10']:.4f} | {values['target_hit@10']:.4f} |" for mode, values in summary.items()]
    (run_dir / "summary.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    return run_dir


def main() -> None:
    parser = argparse.ArgumentParser(description="F1 composed image+text retrieval evaluation.")
    parser.add_argument("--products", type=Path, default=Path("data/a1_abo_1500/products.jsonl"))
    parser.add_argument("--size", type=int, default=40)
    parser.add_argument("--runs-root", type=Path, default=Path("runs/compose"))
    args = parser.parse_args()
    from fastapi import FastAPI

    from shopmind.main import _wire_runtime

    runtime = FastAPI()
    runtime.state.search_service = None
    _wire_runtime(runtime)
    queries = build_compose_benchmark(args.products, size=args.size)
    print(run_compose_evaluation(runtime.state.container.search_service, queries, args.runs_root))


if __name__ == "__main__":
    main()
