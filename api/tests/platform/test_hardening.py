"""Regression tests for the backend review findings (input bounds, errors, auth, config, sessions)."""
from __future__ import annotations

import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from shopmind.application.chat.service import ChatService
from shopmind.core.config import ChatConfig
from shopmind.main import create_app
from tests.api.conftest import FakeEmbedder, FakeRepository, FakeSearchService

from .conftest import login


def _png(width, height):
    buffer = io.BytesIO()
    Image.new("RGB", (width, height), "red").save(buffer, format="PNG")
    return buffer.getvalue()


@pytest.fixture
def search_client():
    app = create_app(search_service=FakeSearchService(), repository=FakeRepository(), embedder=FakeEmbedder(), auto_wire=False)
    with TestClient(app) as client:
        yield app, client


def test_image_uploads_are_bounded_in_pixels_and_downscaled(search_client):
    app, client = search_client
    huge = client.post("/api/v1/search/image", files={"image": ("big.png", _png(8000, 6000), "image/png")})
    assert huge.status_code == 400 and huge.json()["error"]["code"] == "invalid_image"
    ok = client.post("/api/v1/search/image", files={"image": ("ok.png", _png(3000, 2000), "image/png")})
    assert ok.status_code == 200
    image = app.state.search_service.image_requests[-1][0]
    assert max(image.size) <= 1024


def test_search_inputs_have_upper_bounds(search_client):
    _, client = search_client
    assert client.post("/api/v1/search/text", json={"query": "sofa", "top_k": 20000}).status_code == 422
    too_many = client.post("/api/v1/search/text", json={"query": "sofa", "filters": {"brand": [f"b{i}" for i in range(50)]}})
    assert too_many.status_code == 422


@pytest.mark.parametrize("supplied,kept", [("abcdef12-3456", True), ("x" * 200, False), ("<script>", False)])
def test_client_request_ids_are_validated(search_client, supplied, kept):
    _, client = search_client
    response = client.get("/health", headers={"X-Request-ID": supplied})
    assert (response.headers["X-Request-ID"] == supplied) is kept


def test_unhandled_errors_keep_the_json_error_body_and_request_id():
    class Exploding(FakeSearchService):
        def search_text(self, request):
            raise RuntimeError("boom")

    app = create_app(search_service=Exploding(), repository=FakeRepository(), embedder=FakeEmbedder(), auto_wire=False)
    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.post("/api/v1/search/text", json={"query": "sofa", "mode": "bm25"})
    assert response.status_code == 500 and response.json()["error"]["code"] == "internal_error"
    assert response.headers["X-Request-ID"] == response.json()["request_id"]


def test_hidden_or_non_search_pipelines_are_refused_to_shoppers(client, admin):
    from shopmind.application.search.service import SearchService
    from shopmind.core.config import PipelineSpec

    class Factory:
        specs = {"search.hidden": PipelineSpec(kind="search", public=False), "rag.answer": PipelineSpec(kind="rag")}

    service = SearchService(pipelines=Factory())
    with pytest.raises(Exception, match="unknown search pipeline"):
        service.check_requested_pipeline("search.hidden")
    with pytest.raises(Exception, match="unknown search pipeline"):
        service.check_requested_pipeline("rag.answer", allow_hidden=True)
    service.check_requested_pipeline("search.hidden", allow_hidden=True)


def test_config_rejects_unknown_step_impls_and_dangling_defaults(client, admin):
    bad_step = client.put("/api/v1/admin/config", headers=admin, json={"name": "bad", "overrides": {"pipelines.search.hybrid.steps": [{"step": "retrieve", "impl": "bm2"}]}})
    assert bad_step.status_code == 422 and "bm2" in bad_step.text
    bad_default = client.put("/api/v1/admin/config", headers=admin, json={"name": "bad2", "overrides": {"defaults.search": "nope"}})
    assert bad_default.status_code == 422 and "nope" in bad_default.text


def test_tokens_of_deactivated_users_are_rejected(app, client):
    auth = app.state.container.auth_service
    auth.ensure_user("temp", "temp-pass", "annotator")
    headers = login(client, "temp", "temp-pass")
    assert client.get("/api/v1/admin/auth/me", headers=headers).status_code == 200
    from shopmind.infrastructure.db.models import User
    from sqlalchemy import update

    with app.state.container.db.session() as session:
        session.execute(update(User).where(User.username == "temp").values(active=False))
    assert client.get("/api/v1/admin/auth/me", headers=headers).status_code == 401


class _Store:
    def __init__(self):
        self.rows = {}

    def append(self, session_id, role, content, extra=None):
        self.rows.setdefault(session_id, []).append(role)

    def get(self, session_id):
        return self.rows.get(session_id, [])

    def exists(self, session_id):
        return session_id in self.rows


def test_chat_session_ids_are_issued_by_the_server():
    class Rag:
        llm = None

    service = ChatService(Rag(), ChatConfig(), lambda: False, lambda pid: None, understanding=__import__("shopmind.application.chat.intents", fromlist=["x"]).RuleQueryUnderstanding(), store=_Store())
    first = service.prepare("xin chào", [], None, session_id="victims-chosen-id")
    assert first.session_id != "victims-chosen-id" and len(first.session_id) == 32
    service.answer(first)
    again = service.prepare("xin chào", [], None, session_id=first.session_id)
    assert again.session_id == first.session_id
    unknown = service.prepare("xin chào", [], None, session_id="0" * 32)
    assert unknown.session_id != "0" * 32
