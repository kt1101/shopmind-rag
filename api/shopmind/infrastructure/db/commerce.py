"""Synthetic commerce overlay (component ``commerce``): price and stock for the demo storefront.

Values are generated deterministically from the product id (seeded RNG) and are ALWAYS flagged
``synthetic: true``. Rows in ``products_overlay`` (written by ``scripts.seed_demo``) win over the
generated values; without a database the generated values are served directly.
"""
from __future__ import annotations

import hashlib
import math
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


# Plausible USD price bands by category keyword (first match wins), so budget-based features such as
# the shopping planner behave realistically. Still synthetic: labelled as such everywhere.
PRICE_BANDS: tuple[tuple[tuple[str, ...], tuple[float, float]], ...] = (
    (("SOFA", "BED", "DRESSER", "CABINET", "MAJOR_HOME_APPLIANCES", "TELEVISION", "PERSONAL_COMPUTER", "COMPUTER"), (249, 1199)),
    (("TABLE", "DESK", "CHAIR", "OTTOMAN", "BENCH", "HEADBOARD", "SHELF", "BEAN_BAG", "FURNITURE", "STOOL", "RUG", "SUITCASE", "LUGGAGE", "BARBECUE"), (59, 449)),
    (("LAMP", "LIGHT_FIXTURE", "LIGHTING", "WALL_ART", "MIRROR", "HEADPHONES", "SPEAKERS", "WATCH", "FINE", "OUTDOOR_LIVING", "CLOCK", "STORAGE_RACK"), (29, 249)),
    (("SHOES", "BOOT", "SANDAL", "HANDBAG", "BACKPACK", "TOTE_BAG", "FLAT_SHEET", "HOME_BED_AND_BATH", "KITCHEN", "PAN", "OVEN", "PET_SUPPLIES", "SPORTING_GOODS", "EXERCISE", "BARBELL", "KEYBOARD", "MOUSE", "MICROPHONE"), (19, 129)),
    (("CELLULAR_PHONE_CASE", "SCREEN_PROTECTOR", "GROCERY", "FRUIT", "VEGETABLE", "BREAD", "SNACK", "COFFEE", "TEA", "SAUCE", "HAT", "SUNGLASSES", "EYEWEAR", "WALLET", "BOTTLE", "DRINKING_CUP", "JAR", "OFFICE", "WRITING", "STAPLER", "FOLDER", "BEAUTY", "SKIN", "SHAMPOO", "UMBRELLA", "EARRING", "RING", "NECKLACE", "BRACELET"), (6, 59)),
)
DEFAULT_BAND = (9, 99)


def price_band(category: str | None) -> tuple[float, float]:
    value = (category or "").upper()
    for keywords, band in PRICE_BANDS:
        if any(keyword in value for keyword in keywords):
            return band
    return DEFAULT_BAND


def synthetic_overlay(product_id: str, *, seed: int = SEED, currency: str = DEFAULT_CURRENCY, category: str | None = None) -> dict[str, Any]:
    """Deterministic fake price/stock for one product (same id + seed + category → same values).

    With a ``category`` the price falls in a plausible band for that kind of product (log-uniform,
    rounded to x.99); without it a generic band is used.
    """
    digest = hashlib.sha256(f"{seed}:{product_id}".encode()).digest()
    rng = random.Random(int.from_bytes(digest[:8], "big"))
    low, high = price_band(category)
    raw = math.exp(rng.uniform(math.log(low), math.log(high)))
    amount = round(max(1, round(raw) - 1) + 0.99, 2)
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

    def upsert_synthetic(self, product_ids: Iterable[str], *, seed: int = SEED, categories: dict[str, str | None] | None = None, refresh: bool = False) -> int:
        """Write generated rows for products that have none yet (idempotent). Returns rows written.

        ``categories`` makes prices category-aware; ``refresh`` regenerates existing synthetic rows."""
        if self.db is None:
            return 0
        ids = list(dict.fromkeys(str(product_id) for product_id in product_ids if product_id))
        added = 0
        with self.db.session() as session:
            existing = set()
            for start in range(0, len(ids), 500):
                existing.update(session.scalars(select(ProductOverlay.product_id).where(ProductOverlay.product_id.in_(ids[start:start + 500]))))
            for product_id in ids:
                if product_id in existing and not refresh:
                    continue
                values = synthetic_overlay(product_id, seed=seed, category=(categories or {}).get(product_id))
                if product_id in existing:
                    row = session.scalars(select(ProductOverlay).where(ProductOverlay.product_id == product_id)).first()
                    if row is None or not row.synthetic:
                        continue
                    row.price_amount, row.currency, row.in_stock, row.quantity = values["price_amount"], values["currency"], values["in_stock"], values["quantity"]
                else:
                    session.add(ProductOverlay(product_id=product_id, price_amount=values["price_amount"], currency=values["currency"], in_stock=values["in_stock"], quantity=values["quantity"], synthetic=True))
                added += 1
        return added
