from __future__ import annotations

from pathlib import Path

from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from sqlalchemy import create_engine, inspect

from shopmind.infrastructure.db.engine import Database, DatabaseUnavailable, redact_url
from shopmind.infrastructure.db.models import Base

API_DIR = Path(__file__).resolve().parents[2]
TABLES = {"users", "chat_sessions", "chat_messages", "search_events", "click_events", "pipeline_traces", "feedback", "relevance_judgments", "config_profiles", "policies", "products_overlay", "jobs", "eval_runs"}


def _alembic(url: str) -> Config:
    config = Config(str(API_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(API_DIR / "shopmind/infrastructure/db/migrations"))
    config.set_main_option("sqlalchemy.url", url)
    config.attributes["configure_logger"] = False
    return config


def test_alembic_upgrade_creates_every_table_and_matches_models(tmp_path):
    url = f"sqlite:///{(tmp_path / 'migrated.db').as_posix()}"
    command.upgrade(_alembic(url), "head")
    engine = create_engine(url)
    assert TABLES <= set(inspect(engine).get_table_names())
    with engine.connect() as connection:
        diff = compare_metadata(MigrationContext.configure(connection, opts={"compare_type": True}), Base.metadata)
    assert diff == []
    command.downgrade(_alembic(url), "base")
    assert not TABLES & set(inspect(engine).get_table_names())
    engine.dispose()


def test_create_all_stamps_head_so_upgrade_is_a_no_op(tmp_path):
    url = f"sqlite:///{(tmp_path / 'auto.db').as_posix()}"
    db = Database(url)
    db.ensure_ready(auto_create=True)
    with db.engine.connect() as connection:
        assert MigrationContext.configure(connection).get_current_revision() == "0001"
    db.dispose()
    command.upgrade(_alembic(url), "head")  # must not try to recreate the tables


def test_in_memory_fallback_and_status(tmp_path):
    memory = Database.in_memory_db()
    assert memory.status() == "disabled" and memory.in_memory
    with memory.session() as session:  # tables are created lazily
        assert session.bind is not None
    file_db = Database(f"sqlite:///{(tmp_path / 'nested' / 'x.db').as_posix()}")
    assert file_db.status() == "ok"
    file_db.dispose()


def test_session_errors_become_database_unavailable(tmp_path):
    db = Database(f"sqlite:///{(tmp_path / 'empty.db').as_posix()}")  # no tables, auto_create off
    from shopmind.infrastructure.db.models import User

    try:
        with db.session() as session:
            session.query(User).all()
    except DatabaseUnavailable:
        pass
    else:  # pragma: no cover
        raise AssertionError("expected DatabaseUnavailable")
    db.mark_down(60)
    assert not db.available
    db.dispose()


def test_redact_url_hides_password():
    assert "secret" not in redact_url("postgresql+psycopg://shop:secret@db:5432/shopmind")
