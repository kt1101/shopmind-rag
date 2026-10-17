"""Synthetic commerce overlay (component ``commerce``): price and stock for the demo storefront.

Values are generated deterministically from the product id (seeded RNG) and are ALWAYS flagged
``synthetic: true``. Rows in ``products_overlay`` (written by ``scripts.seed_demo``) win over the
generated values; without a database the generated values are served directly.
"""
from __future__ import annotations

import hashlib
import logging
import random
from collections.abc import Iterable
from typing import Any

from sqlalchemy import select

from shopmind.infrastructure.db.engine import Database, DatabaseUnavailable
from shopmind.infrastructure.db.models import ProductOverlay

logger = logging.getLogger("shopmind.db.commerce")

DEFAULT_CURRENCY = "USD"
SEED = 42


def synthetic_overlay(product_id: str, *, seed: int = SEED, currency: str = DEFAULT_CURRENCY) -> dict[str, Any]:
    """Deterministic fake price/stock for one product (same id + seed → same values)."""
    digest = hashlib.sha256(f"{seed}:{product_id}".encode()).digest()
    rng = random.Random(int.from_bytes(digest[:8], "big"))
    amount = round(rng.choice([4, 9, 14, 19, 24, 29, 39, 49, 59, 79, 99, 129, 149, 199, 249]) + 0.99 + rng.choice([0, 0, 0, 10, 20]), 2)
    in_stock = rng.random() >= 0.12
    quantity = rng.randint(1, 120) if in_stock else 0
    return {"product_id": product_id, "price_amount": amount, "currency": currency, "in_stock": in_stock, "quantity": quantity}


def _shape(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "price": {"amount": float(row["price_amount"]), "currency": row["currency"], "synthetic": True},
        "stock": {"in_stock": bool(row["in_stock"]), "quantity": int(row["quantity"]), "synthetic": True},
    }


class ProductOverlayService:
    """``get(product_id)`` / ``get_many(ids)`` → ``{price:{amount,currency,synthetic}, stock:{in_stock,quantity,synthetic}}``."""

    def __init__(self, db: Database | None = None, *, enabled: bool = True, generate_missing: bool = True) -> None:
        self.db = db
        self.enabled = enabled
        self.generate_missing = generate_missing

    def get(self, product_id: str) -> dict[str, Any] | None:
        return self.get_many([product_id]).get(product_id)

    def get_many(self, product_ids: Iterable[str]) -> dict[str, dict[str, Any]]:
        ids = [str(product_id) for product_id in dict.fromkeys(product_ids) if product_id]
        if not self.enabled or not ids:
            return {}
        stored: dict[str, dict[str, Any]] = {}
        if self.db is not None and self.db.enabled:
            try:
                with self.db.session() as session:
                    for row in session.scalars(select(ProductOverlay).where(ProductOverlay.product_id.in_(ids))):
                        stored[row.product_id] = {"price_amount": row.price_amount, "currency": row.currency, "in_stock": row.in_stock, "quantity": row.quantity}
            except DatabaseUnavailable as exc:
                logger.warning("commerce overlay lookup failed, using generated values: %s", exc)
        result = {}
        for product_id in ids:
            row = stored.get(product_id) or (synthetic_overlay(product_id) if self.generate_missing else None)
            if row is not None:
                result[product_id] = _shape(row)
        return result

    def upsert_synthetic(self, product_ids: Iterable[str], *, seed: int = SEED) -> int:
        """Write generated rows for products that have none yet (idempotent). Returns rows added."""
        if self.db is None:
            return 0
        ids = list(dict.fromkeys(str(product_id) for product_id in product_ids if product_id))
        added = 0
        with self.db.session() as session:
            existing = set()
            for start in range(0, len(ids), 500):
                existing.update(session.scalars(select(ProductOverlay.product_id).where(ProductOverlay.product_id.in_(ids[start:start + 500]))))
            for product_id in ids:
                if product_id in existing:
                    continue
                values = synthetic_overlay(product_id, seed=seed)
                session.add(ProductOverlay(product_id=product_id, price_amount=values["price_amount"], currency=values["currency"], in_stock=values["in_stock"], quantity=values["quantity"], synthetic=True))
                added += 1
        return added
