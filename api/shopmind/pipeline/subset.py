from __future__ import annotations

import random
from collections import defaultdict

from shopmind.app.domain.product import Product

_UNKNOWN = "__unknown__"


def select_balanced_subset(products: list[Product], limit: int, seed: int) -> list[Product]:
    if limit < 0:
        raise ValueError("limit must be non-negative")
    if limit == 0 or not products:
        return []
    grouped: dict[str, list[Product]] = defaultdict(list)
    for product in products:
        grouped[product.category or _UNKNOWN].append(product)
    rng = random.Random(seed)
    category_keys = sorted(grouped)
    for category in category_keys:
        grouped[category].sort(key=lambda product: product.product_id)
        rng.shuffle(grouped[category])
    selected: list[Product] = []
    positions = {category: 0 for category in category_keys}
    target = min(limit, len(products))
    while len(selected) < target:
        progressed = False
        for category in category_keys:
            position = positions[category]
            bucket = grouped[category]
            if position >= len(bucket):
                continue
            selected.append(bucket[position])
            positions[category] = position + 1
            progressed = True
            if len(selected) == target:
                break
        if not progressed:
            break
    return selected
