"""System of record: ``db`` (engine + sessions) and ``db_writer`` (off-request-path writes).

Non-critical: when PostgreSQL is down, search keeps working and DB-backed features degrade.
With ``database.enabled: false`` the platform runs on a private in-memory SQLite database, so
every component exists in tests (``create_app(auto_wire=False)``) and eval runs.
Runs before ``tracing`` (ORDER 5) so ``tracing.store: database`` resolves.
"""
from __future__ import annotations

import logging

ORDER = 1
CRITICAL = False
LIGHTWEIGHT = True

logger = logging.getLogger("shopmind.bootstrap.database")


def wire(container) -> None:
    from shopmind.infrastructure.db import trace_store  # noqa: F401  (registers trace_store "database")
    from shopmind.infrastructure.db.engine import Database, redact_url
    from shopmind.infrastructure.db.writer import BackgroundWriter

    config = container.config.database
    db = container.get("db") or container.provide("db", Database.from_config(config))
    if container.get("db_writer") is None:
        container.provide("db_writer", BackgroundWriter(db))
    if db.enabled:
        logger.info("database: %s", redact_url(db.url))
        db.ensure_ready(auto_create=config.auto_create)
