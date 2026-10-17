from __future__ import annotations

from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient

from shopmind.core.trace_store import InMemoryTraceStore
from shopmind.infrastructure.db.commerce import ProductOverlayService, synthetic_overlay
from shopmind.infrastructure.db.engine import Database
from shopmind.infrastructure.db.trace_store import DatabaseTraceStore, input_summary
from shopmind.infrastructure.db.writer import BackgroundWriter
from shopmind.main import create_app


def _trace(trace_id, created_at=None, query="q"):
    created = (created_at or datetime.now(UTC)).isoformat().replace("+00:00", "Z")
    return {"trace_id": trace_id, "kind": "search", "pipeline": "search.hybrid", "created_at": created, "duration_ms": 1.0, "input": {"query": query}, "steps": [], "output": {}}


def test_feedback_and_click_endpoints(client):
    created = client.post("/api/v1/feedback", json={"target": "answer", "trace_id": "abc", "rating": -1, "query": "q", "comment": "bad"})
    assert created.status_code == 201 and isinstance(created.json()["id"], int)
    for body in ({"target": "search", "trace_id": "abc", "rating": 0}, {"target": "other", "trace_id": "abc", "rating": 1}, {"target": "search", "rating": 1}):
        response = client.post("/api/v1/feedback", json=body)
        assert response.status_code == 422 and response.json()["error"]["code"] == "validation_error"
    click = client.post("/api/v1/events/click", json={"trace_id": "abc", "product_id": "P1", "rank": 1})
    assert click.status_code == 204 and click.content == b""
    assert client.post("/api/v1/events/click", json={"trace_id": "abc", "product_id": "P1", "rank": 0}).status_code == 422


def test_database_trace_store_round_trip_and_retention():
    db = Database.in_memory_db()
    store = DatabaseTraceStore(db=db, writer=BackgroundWriter(db), retention_days=1)
    store.save(_trace("new", query="leather boots"))
    store.save(_trace("old", created_at=datetime.now(UTC) - timedelta(days=3)))
    assert store.get("new")["input"]["query"] == "leather boots"
    assert store.get("old") is None  # past retention, even while still cached
    total, items = store.list()
    assert total == 1 and items[0]["trace_id"] == "new"
    assert store.list(q="boots")[0] == 1 and store.list(q="nothing")[0] == 0
    assert store.purge_expired() == 1
    fresh = DatabaseTraceStore(db=db, writer=BackgroundWriter(db), retention_days=1)  # empty cache → read from DB
    assert fresh.get("new")["trace_id"] == "new"


def test_trace_store_degrades_when_database_is_down():
    db = Database.in_memory_db()
    store = DatabaseTraceStore(db=db, writer=BackgroundWriter(db))
    db.mark_down(60)
    store.save(_trace("t1"))  # dropped write, no exception
    assert store.get("t1")["trace_id"] == "t1"  # served from the in-memory cache
    assert store.list()[0] == 1


def test_input_summary_variants():
    assert input_summary({"input": {"query": "boots"}}) == "boots"
    assert input_summary({"kind": "image_search", "input": {"image_size": 10}}) == "[image upload]"
    assert input_summary({"input": {"text": "red", "image_name": "x.jpg"}}) == '[image] + "red"'


def test_platform_components_work_without_a_database():
    app = create_app(auto_wire=False)  # default test config: database disabled, auth disabled
    container = app.state.container
    assert container.db.status() == "disabled"
    assert isinstance(container.trace_store, InMemoryTraceStore)
    container.event_log.record_search("t1", "boots", "hybrid", "search.hybrid", 3.0, 2, {})
    container.chat_store.append("s1", "user", "hello")
    container.chat_store.append("s1", "assistant", "hi", {"sources": [{"citation_id": "c1"}], "intent": "chitchat", "text_vector": [0.1] * 10})
    messages = container.chat_store.get("s1")
    assert [m["role"] for m in messages] == ["user", "assistant"]
    assert messages[1]["sources"] == [{"citation_id": "c1"}] and "text_vector" not in messages[1] and messages[1]["created_at"]
    assert container.chat_store.get("missing") == []
    stats = container.event_log.stats(1)
    assert stats["totals"]["searches"] == 1
    client = TestClient(app)
    assert client.post("/api/v1/feedback", json={"target": "search", "trace_id": "t1", "rating": 1}).status_code == 201
    assert client.get("/api/v1/admin/stats").status_code == 200  # auth disabled in this config


def test_chat_store_survives_database_outage(app):
    store = app.state.container.chat_store
    app.state.container.db.mark_down(60)
    assert store.append("s1", "user", "hello") is False
    assert store.get("s1") == []


def test_commerce_overlay_is_deterministic_and_flagged_synthetic(app):
    service: ProductOverlayService = app.state.container.commerce
    first = service.get("B07XYZ")
    assert first == service.get("B07XYZ")
    assert first["price"]["synthetic"] is True and first["stock"]["synthetic"] is True
    assert first["price"]["currency"] == "USD" and first["price"]["amount"] > 0
    assert set(service.get_many(["A", "B", "A"])) == {"A", "B"}
    assert service.upsert_synthetic(["A", "B"]) == 2 and service.upsert_synthetic(["A"]) == 0
    assert service.get("A")["price"]["amount"] == synthetic_overlay("A")["price_amount"]
    assert ProductOverlayService(None, enabled=False).get("A") is None
