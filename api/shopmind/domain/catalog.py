from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class ProductPage:
    items: tuple[dict[str, Any], ...]
    total: int
    category_facets: tuple[tuple[str, int], ...]
