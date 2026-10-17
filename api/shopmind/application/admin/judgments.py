"""Relevance-judgment math: Cohen's kappa between annotators and qrels export.

qrels lines follow ``evaluation/benchmarks/a1/qrels.jsonl``: ``{"product_id", "query_id",
"relevance"}`` (plus the query text, which the loaders ignore). A judged query that matches a
benchmark query (case-insensitive) reuses its ``query_id``; other queries get a stable
``j_<hash>`` id.
"""
from __future__ import annotations

import hashlib
import json
from collections import defaultdict
from collections.abc import Iterable, Mapping
from itertools import combinations
from statistics import median
from typing import Any

GRADES = (0, 1, 2)


def cohens_kappa(left: list[int], right: list[int], categories: Iterable[int] = GRADES) -> float | None:
    """Unweighted Cohen's kappa for two aligned rating lists (``None`` when undefined)."""
    if len(left) != len(right) or not left:
        return None
    n = len(left)
    categories = list(categories)
    observed = sum(a == b for a, b in zip(left, right, strict=True)) / n
    expected = sum((left.count(c) / n) * (right.count(c) / n) for c in categories)
    if expected >= 1.0:
        return 1.0 if observed >= 1.0 else 0.0
    return (observed - expected) / (1 - expected)


def agreement(judgments: Iterable[Mapping[str, Any]]) -> dict[str, Any]:
    """Kappa per annotator pair over items both judged, plus the item-weighted mean."""
    by_item: dict[tuple[str, str], dict[str, int]] = defaultdict(dict)
    for row in judgments:
        by_item[(str(row["query"]).strip().casefold(), str(row["product_id"]))][str(row["annotator"])] = int(row["grade"])
    annotators = sorted({annotator for grades in by_item.values() for annotator in grades})
    by_pair = []
    for first, second in combinations(annotators, 2):
        shared = [grades for grades in by_item.values() if first in grades and second in grades]
        if not shared:
            continue
        kappa = cohens_kappa([grades[first] for grades in shared], [grades[second] for grades in shared])
        by_pair.append({"annotators": [first, second], "kappa": None if kappa is None else round(kappa, 4), "items": len(shared)})
    measured = [pair for pair in by_pair if pair["kappa"] is not None]
    total = sum(pair["items"] for pair in measured)
    kappa = round(sum(pair["kappa"] * pair["items"] for pair in measured) / total, 4) if total else None
    return {"kappa": kappa, "pairs": sum(pair["items"] for pair in by_pair), "annotators": annotators, "by_pair": by_pair}


def query_id_for(query: str, benchmark: Mapping[str, str]) -> str:
    key = query.strip().casefold()
    if key in benchmark:
        return benchmark[key]
    return "j_" + hashlib.sha1(key.encode("utf-8")).hexdigest()[:10]


def aggregate_grade(grades: list[int], method: str = "max") -> int:
    if method == "median":
        return int(round(median(grades)))
    if method == "mean":
        return int(round(sum(grades) / len(grades)))
    return max(grades)


def qrels_lines(judgments: Iterable[Mapping[str, Any]], benchmark: Mapping[str, str] | None = None, *, aggregate: str = "max") -> list[str]:
    benchmark = benchmark or {}
    grouped: dict[tuple[str, str], list[int]] = defaultdict(list)
    texts: dict[str, str] = {}
    for row in judgments:
        query = str(row["query"]).strip()
        query_id = query_id_for(query, benchmark)
        texts.setdefault(query_id, query)
        grouped[(query_id, str(row["product_id"]))].append(int(row["grade"]))
    lines = []
    for (query_id, product_id), grades in sorted(grouped.items()):
        lines.append(json.dumps({"product_id": product_id, "query_id": query_id, "relevance": aggregate_grade(grades, aggregate), "query": texts[query_id]}, ensure_ascii=False, sort_keys=True))
    return lines


def load_benchmark_queries(path: Any) -> dict[str, str]:
    """``{casefolded query text: query_id}`` from a benchmark ``queries.jsonl`` (missing file → empty)."""
    from pathlib import Path

    path = Path(path)
    if not path.exists():
        return {}
    mapping: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        if row.get("query") and row.get("query_id"):
            mapping.setdefault(str(row["query"]).strip().casefold(), str(row["query_id"]))
    return mapping
