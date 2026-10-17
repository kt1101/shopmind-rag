"""Alembic environment: same models as the app (``shopmind.infrastructure.db.models``).

URL resolution: ``sqlalchemy.url`` set programmatically → ``DATABASE_URL`` → layered app config
(``SHOPMIND_CONFIG`` / ``configs/app.yaml`` + profile) → the ``DatabaseConfig`` default.
"""
from __future__ import annotations

import os
from logging.config import fileConfig
from pathlib import Path

from alembic import context
from sqlalchemy import engine_from_config, pool
from sqlalchemy.engine import make_url

from shopmind.infrastructure.db.models import Base

config = context.config
if config.config_file_name is not None and config.attributes.get("configure_logger", True):
    fileConfig(config.config_file_name, disable_existing_loggers=False)

target_metadata = Base.metadata


def database_url() -> str:
    url = config.get_main_option("sqlalchemy.url")
    if url:
        return url
    if os.getenv("DATABASE_URL"):
        return os.environ["DATABASE_URL"]
    try:
        from shopmind.core.config import load_app_config

        return load_app_config(Path(os.getenv("SHOPMIND_CONFIG", "configs/app.yaml"))).database.url
    except Exception:
        from shopmind.core.config import DatabaseConfig

        return DatabaseConfig().url


def _prepare_sqlite_dir(url: str) -> None:
    parsed = make_url(url)
    if parsed.get_backend_name() == "sqlite" and parsed.database not in (None, "", ":memory:"):
        Path(parsed.database).expanduser().parent.mkdir(parents=True, exist_ok=True)


def run_migrations_offline() -> None:
    context.configure(url=database_url(), target_metadata=target_metadata, literal_binds=True, dialect_opts={"paramstyle": "named"}, render_as_batch=True)
    with context.begin_transaction():
        context.run_migrations()


def _run(connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata, render_as_batch=connection.dialect.name == "sqlite", compare_type=True)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    existing = config.attributes.get("connection")
    if existing is not None:
        _run(existing)
        return
    url = database_url()
    _prepare_sqlite_dir(url)
    section = dict(config.get_section(config.config_ini_section) or {})
    section["sqlalchemy.url"] = url
    engine = engine_from_config(section, prefix="sqlalchemy.", poolclass=pool.NullPool)
    with engine.connect() as connection:
        _run(connection)


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
