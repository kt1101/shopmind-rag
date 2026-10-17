"""Seed demo data into the system of record (``make seed`` → ``python -m scripts.seed_demo``).

Idempotent: re-running only adds what is missing.

1. Create missing tables (``create_all`` + Alembic stamp on a fresh database).
2. Bootstrap admin (``ADMIN_USERNAME`` / ``ADMIN_PASSWORD``) and an ``annotator`` user
   (``ANNOTATOR_PASSWORD``, default ``annotator``).
3. Import ``data/policies/*.jsonl`` into the policy CMS (published v1).
4. Synthetic price/stock rows (``products_overlay``, flagged synthetic, seed 42) for every product
   in ``data/a1_abo_1500/products.jsonl`` when that file exists.
5. Import ``runs/**/metrics.json`` into ``eval_runs``.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any

from shopmind.core.config import AppConfig, load_app_config


def _product_ids(path: Path) -> list[str]:
    return list(_product_categories(path))


def _product_categories(path: Path) -> dict[str, str | None]:
    categories: dict[str, str | None] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            row = json.loads(line)
            if row.get("product_id"):
                categories[str(row["product_id"])] = row.get("category")
    return categories


def seed(config: AppConfig, *, products: Path, policies: Path, runs: Path, annotator: str = "annotator", annotator_password: str | None = None, seed_value: int = 42, refresh_prices: bool = False, log=print) -> dict[str, Any]:
    from shopmind.infrastructure.auth import AuthService
    from shopmind.infrastructure.db.commerce import ProductOverlayService
    from shopmind.infrastructure.db.engine import Database, redact_url
    from shopmind.infrastructure.db.eval_runs import EvalRunRepository
    from shopmind.infrastructure.db.policies import PolicyRepository

    if not config.database.enabled:
        raise SystemExit("database.enabled is false: nothing to seed")
    db = Database.from_config(config.database)
    log(f"database: {redact_url(db.url)}")
    db.create_all()
    summary: dict[str, Any] = {}

    auth = AuthService(db, config.auth)
    summary["admin_created"] = auth.ensure_bootstrap_admin()
    if not config.auth.admin_password:
        log("ADMIN_PASSWORD is not set: admin account not created")
    summary["annotator_created"] = auth.ensure_user(annotator, annotator_password or "annotator", "annotator")

    summary["policies_added"] = PolicyRepository(db).seed_from(policies)
    if products.exists():
        categories = _product_categories(products)
        summary["overlay_added"] = ProductOverlayService(db).upsert_synthetic(list(categories), seed=seed_value, categories=categories, refresh=refresh_prices)
    else:
        log(f"{products} not found: skipping synthetic price/stock")
        summary["overlay_added"] = 0
    summary["eval_runs_imported"] = len(EvalRunRepository(db).import_dir(runs))
    db.dispose()
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed ShopMind demo data (users, policies, synthetic commerce, eval runs).")
    parser.add_argument("--config", type=Path, default=Path(os.getenv("SHOPMIND_CONFIG", "configs/app.yaml")))
    parser.add_argument("--products", type=Path, default=Path("data/a1_abo_1500/products.jsonl"))
    parser.add_argument("--refresh-prices", action="store_true", help="regenerate existing synthetic price/stock rows (category-aware)")
    parser.add_argument("--policies", type=Path, default=None, help="default: jobs.policies_source")
    parser.add_argument("--runs", type=Path, default=None, help="default: jobs.runs_dir")
    parser.add_argument("--annotator", default="annotator")
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()
    config = load_app_config(args.config)
    summary = seed(config, products=args.products, policies=args.policies or Path(config.jobs.policies_source), runs=args.runs or Path(config.jobs.runs_dir), annotator=args.annotator, annotator_password=os.getenv("ANNOTATOR_PASSWORD"), seed_value=args.seed, refresh_prices=args.refresh_prices)
    print(json.dumps(summary, sort_keys=True))


if __name__ == "__main__":
    main()
