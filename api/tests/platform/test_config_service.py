from __future__ import annotations

import pytest

from shopmind.application.admin.config_rules import expand_hot_reloadable, is_hot_reloadable, redact, resolve_path
from shopmind.application.admin.config_service import ConfigService, ConfigValidationError
from shopmind.infrastructure.db.engine import Database
from shopmind.infrastructure.db.repositories import ProfileRepository
from tests.platform.conftest import JWT_SECRET, make_config


@pytest.fixture
def service(tmp_path):
    db = Database.in_memory_db()
    return ConfigService(make_config(tmp_path), ProfileRepository(db), refresh_seconds=0)


def test_hot_reloadable_patterns_support_prefixes_and_wildcards():
    patterns = ["retrieval.top_k", "rag.fusion.*", "pipelines.*.steps"]
    assert is_hot_reloadable("retrieval.top_k", patterns)
    assert is_hot_reloadable("rag.fusion.rrf_k", patterns)
    assert is_hot_reloadable("pipelines.search.hybrid.steps", patterns)
    assert not is_hot_reloadable("retrieval.candidate_k", patterns)
    assert not is_hot_reloadable("rag.fusion", patterns)
    assert not is_hot_reloadable("pipelines.search.hybrid.kind", patterns)


def test_dotted_keys_resolve_against_dotted_mapping_names():
    data = {"pipelines": {"search.hybrid": {"steps": []}}, "retrieval": {"top_k": 1}}
    assert resolve_path(data, "pipelines.search.hybrid.steps") == ["pipelines", "search.hybrid", "steps"]
    assert resolve_path(data, "retrieval.top_k") == ["retrieval", "top_k"]
    assert "pipelines.search.hybrid.steps" in expand_hot_reloadable(data, ["pipelines.*.steps"])


def test_overrides_are_validated_and_applied(service):
    config = service.build({"retrieval.top_k": 7, "rag.fusion.method": "concat", "pipelines.search.hybrid.steps": [{"step": "retrieve", "impl": "dense"}]})
    assert config.retrieval.top_k == 7 and config.rag.fusion.method == "concat"
    assert config.pipelines["search.hybrid"].steps[0].impl == "dense"
    with pytest.raises(ConfigValidationError) as caught:
        service.build({"retrieval.top_k": 0, "api.max_image_bytes": 1, "rag.fusion.method": "magic", "pipelines.search.hybrid.steps": [{"step": "retrieve"}]})
    fields = {item["field"]: item["message"] for item in caught.value.details}
    assert fields["api.max_image_bytes"] == "Key is not hot-reloadable"
    assert {"retrieval.top_k", "rag.fusion.method", "pipelines.search.hybrid.steps"} <= set(fields)


def test_unknown_key_under_allowed_prefix_is_rejected(service):
    with pytest.raises(ConfigValidationError) as caught:
        service.build({"rag.context.not_a_key": 3})
    assert caught.value.details[0]["field"] == "rag.context.not_a_key"


def test_profiles_save_merge_activate_and_rollback(service):
    events = []
    service.subscribe(lambda config: events.append(config.fusion.rrf_k))
    assert service.effective().fusion.rrf_k == 60
    first = service.save_profile("k30", {"fusion.rrf_k": 30}, "admin")
    second = service.save_profile("top5", {"retrieval.top_k": 5}, "admin")
    assert second["overrides"] == {"fusion.rrf_k": 30, "retrieval.top_k": 5}  # merged on the active profile
    assert service.effective().retrieval.top_k == 5
    service.activate(first["id"])
    assert service.effective().retrieval.top_k == 10 and service.effective().fusion.rrf_k == 30
    assert [item["active"] for item in service.list_profiles()] == [False, True, False]
    assert events and events[0] == 30
    with pytest.raises(ConfigValidationError):
        service.save_profile("", {"retrieval.top_k": 3})


def test_redaction_hides_secrets_and_url_passwords(tmp_path):
    config = make_config(tmp_path, database={"url": "postgresql+psycopg://shop:pg-pass@db/shop"})
    data = redact(config.model_dump(mode="json"))
    assert data["auth"]["jwt_secret"] == "***" and data["auth"]["admin_password"] == "***"
    assert "pg-pass" not in data["database"]["url"]
    assert data["rag"]["llm"]["api_key"] is None and data["auth"]["token_ttl_minutes"] == 480


def test_admin_config_endpoints(client, admin, app):
    response = client.get("/api/v1/admin/config", headers=admin)
    body = response.json()
    assert response.status_code == 200
    assert JWT_SECRET not in response.text
    assert "retrieval.top_k" in body["hot_reloadable"] and "pipelines.search.hybrid.steps" in body["hot_reloadable"]
    assert "rag.context.max_characters" in body["hot_reloadable"]
    assert body["active_profile"]["name"] == "base"
    assert any(spec["key"] == "rag.fusion.method" and spec["type"] == "enum" for spec in body["hot_reloadable_specs"])

    bad = client.put("/api/v1/admin/config", headers=admin, json={"name": "bad", "overrides": {"retrieval.top_k": 0, "elasticsearch.url": "http://x"}})
    assert bad.status_code == 422
    error = bad.json()["error"]
    assert error["code"] == "validation_error"
    assert {item["field"] for item in error["details"]} == {"retrieval.top_k", "elasticsearch.url"}

    saved = client.put("/api/v1/admin/config", headers=admin, json={"name": "k30", "overrides": {"fusion.rrf_k": 30}})
    assert saved.status_code == 200
    assert saved.json()["profile"]["name"] == "k30" and saved.json()["effective"]["fusion"]["rrf_k"] == 30
    from shopmind.interfaces.http.deps import get_config

    class FakeRequest:
        def __init__(self, app):
            self.app = app

    assert get_config(FakeRequest(app)).fusion.rrf_k == 30

    profiles = client.get("/api/v1/admin/config/profiles", headers=admin).json()["items"]
    assert [item["name"] for item in profiles] == ["k30", "baseline"]
    rollback = profiles[-1]
    response = client.post(f"/api/v1/admin/config/profiles/{rollback['id']}/activate", headers=admin)
    assert response.status_code == 200 and response.json()["effective"]["fusion"]["rrf_k"] == 60
    assert client.post("/api/v1/admin/config/profiles/9999/activate", headers=admin).status_code == 404
