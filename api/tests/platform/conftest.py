from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

import shopmind.infrastructure.auth as auth_module
from shopmind.core.config import AppConfig
from shopmind.main import create_app

JWT_SECRET = "test-secret-0123456789abcdefghij"
ADMIN_PASSWORD = "admin-pass"
HOT = ["retrieval.top_k", "retrieval.candidate_k", "retrieval.default_mode", "fusion.rrf_k", "reranker.enabled", "rag.fusion.*", "rag.context.*", "rag.llm.model", "defaults.*", "pipelines.*.steps"]


@pytest.fixture(autouse=True)
def fast_bcrypt(monkeypatch):
    monkeypatch.setattr(auth_module, "BCRYPT_ROUNDS", 4)


def make_config(tmp_path: Path, **sections: Any) -> AppConfig:
    data: dict[str, Any] = {
        "elasticsearch": {"url": "http://localhost:9200"},
        "embedding": {"model_name": "unconfigured"},
        "retrieval": {}, "fusion": {}, "reranker": {},
        "database": {"enabled": True, "url": f"sqlite:///{(tmp_path / 'platform.db').as_posix()}", "auto_create": True, "seed_policies": False},
        "auth": {"enabled": True, "jwt_secret": JWT_SECRET, "admin_password": ADMIN_PASSWORD},
        "tracing": {"store": "database", "retention_days": 7},
        "features": {"rate_limit_per_minute": 0},
        "jobs": {"import_runs_on_startup": False, "runs_dir": (tmp_path / "runs").as_posix(), "work_dir": (tmp_path / "jobs").as_posix(), "policies_source": (tmp_path / "policies").as_posix()},
        "pipelines": {"search.hybrid": {"kind": "search", "steps": [{"step": "retrieve", "impl": "bm25", "id": "lexical"}]}},
        "defaults": {"search": "search.hybrid"},
        "hot_reloadable": HOT,
    }
    for key, value in sections.items():
        data[key] = {**data.get(key, {}), **value} if isinstance(value, dict) and isinstance(data.get(key), dict) else value
    return AppConfig.model_validate(data)


@pytest.fixture
def config(tmp_path) -> AppConfig:
    return make_config(tmp_path)


@pytest.fixture
def app(config):
    app = create_app(auto_wire=False, config=config)
    yield app
    runner = app.state.container.get("job_runner")
    if runner is not None:
        runner.shutdown(wait=True)
    app.state.container.get("db_writer").flush()
    app.state.container.get("db").dispose()


@pytest.fixture
def client(app) -> TestClient:
    return TestClient(app)


def login(client: TestClient, username: str = "admin", password: str = ADMIN_PASSWORD) -> dict[str, str]:
    response = client.post("/api/v1/admin/auth/login", json={"username": username, "password": password})
    assert response.status_code == 200, response.text
    return {"authorization": f"Bearer {response.json()['access_token']}"}


@pytest.fixture
def admin(client) -> dict[str, str]:
    return login(client)


@pytest.fixture
def annotator(app, client) -> dict[str, str]:
    app.state.container.auth_service.ensure_user("annotator", "annotator-pass", "annotator")
    return login(client, "annotator", "annotator-pass")
