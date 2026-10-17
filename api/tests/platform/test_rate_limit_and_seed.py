from __future__ import annotations

import json

from fastapi import Depends
from fastapi.testclient import TestClient

from shopmind.infrastructure.db.engine import Database
from shopmind.interfaces.http.ratelimit import SlidingWindowLimiter, rate_limit
from shopmind.main import create_app
from tests.platform.conftest import make_config


def test_sliding_window_limiter():
    limiter = SlidingWindowLimiter(window_seconds=60)
    assert [limiter.hit("ip", 2, now=0)[0], limiter.hit("ip", 2, now=1)[0], limiter.hit("ip", 2, now=2)[0]] == [True, True, False]
    assert limiter.hit("other", 2, now=2)[0] is True
    allowed, retry = limiter.hit("ip", 2, now=30)
    assert not allowed and retry == 30
    assert limiter.hit("ip", 2, now=60.5)[0] is True  # first hit left the window
    assert limiter.hit("ip", 0, now=61)[0] is True  # 0 disables


def _limited_app(tmp_path, limit):
    app = create_app(auto_wire=False, config=make_config(tmp_path, features={"rate_limit_per_minute": limit}))

    @app.post("/api/v1/limited", dependencies=[Depends(rate_limit)])
    def limited() -> dict:
        return {"ok": True}

    return TestClient(app)


def test_rate_limit_dependency_returns_429(tmp_path):
    client = _limited_app(tmp_path, 2)
    assert [client.post("/api/v1/limited").status_code for _ in range(3)] == [200, 200, 429]
    body = client.post("/api/v1/limited").json()
    assert body["error"]["code"] == "rate_limited" and body["request_id"]


def test_rate_limit_zero_disables(tmp_path):
    client = _limited_app(tmp_path, 0)
    assert all(client.post("/api/v1/limited").status_code == 200 for _ in range(5))


def test_seed_demo_is_idempotent(tmp_path, monkeypatch):
    from scripts.seed_demo import seed
    from shopmind.infrastructure.db.models import ProductOverlay, User

    products = tmp_path / "products.jsonl"
    products.write_text("\n".join(json.dumps({"product_id": f"P{i}", "title": "x"}) for i in range(5)) + "\n", encoding="utf-8")
    runs = tmp_path / "runs" / "a1" / "20261011T100000Z_bm25"
    runs.mkdir(parents=True)
    (runs / "metrics.json").write_text(json.dumps({"experiment_name": "bm25", "metrics": {"Recall@10": 0.5}}), encoding="utf-8")
    config = make_config(tmp_path)
    kwargs = {"products": products, "policies": __import__("pathlib").Path("data/policies"), "runs": tmp_path / "runs", "log": lambda *_: None}
    first = seed(config, **kwargs)
    assert first["admin_created"] and first["annotator_created"] and first["policies_added"] > 0
    assert first["overlay_added"] == 5 and first["eval_runs_imported"] == 1
    second = seed(config, **kwargs)
    assert not second["admin_created"] and not second["annotator_created"] and second["policies_added"] == 0 and second["overlay_added"] == 0
    db = Database(config.database.url)
    with db.session() as session:
        assert {user.role for user in session.query(User)} == {"admin", "annotator"}
        assert all(row.synthetic for row in session.query(ProductOverlay))
    db.dispose()
