from __future__ import annotations

import math


def _validate_k(k: int) -> None:
    if k <= 0:
        raise ValueError("k must be positive")


def _positive_relevant(relevance: dict[str, int]) -> set[str]:
    return {product_id for product_id, grade in relevance.items() if grade > 0}


def recall_at_k(ranked_product_ids: list[str], relevance: dict[str, int], k: int) -> float:
    _validate_k(k)
    relevant = _positive_relevant(relevance)
    if not relevant:
        return 0.0
    retrieved_relevant = set(ranked_product_ids[:k]) & relevant
    return len(retrieved_relevant) / len(relevant)


def mrr_at_k(ranked_product_ids: list[str], relevance: dict[str, int], k: int) -> float:
    _validate_k(k)
    relevant = _positive_relevant(relevance)
    if not relevant:
        return 0.0
    for rank, product_id in enumerate(ranked_product_ids[:k], start=1):
        if product_id in relevant:
            return 1.0 / rank
    return 0.0


def _dcg(grades: list[int]) -> float:
    return sum((2**grade - 1) / math.log2(rank + 1) for rank, grade in enumerate(grades, start=1))


def ndcg_at_k(ranked_product_ids: list[str], relevance: dict[str, int], k: int) -> float:
    _validate_k(k)
    positive_grades = [grade for grade in relevance.values() if grade > 0]
    if not positive_grades:
        return 0.0
    seen: set[str] = set()
    observed = []
    for product_id in ranked_product_ids[:k]:
        observed.append(0 if product_id in seen else max(0, int(relevance.get(product_id, 0))))
        seen.add(product_id)
    dcg = _dcg(observed)
    ideal = sorted(positive_grades, reverse=True)[:k]
    idcg = _dcg(ideal)
    return 0.0 if idcg == 0.0 else dcg / idcg
