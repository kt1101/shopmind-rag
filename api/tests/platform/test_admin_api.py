from __future__ import annotations

import json
from datetime import UTC, datetime

from shopmind.ingestion.policy_loader import load_policy_sections


def _trace(trace_id: str, query: str, kind: str = "search", pipeline: str = "search.hybrid") -> dict:
    return {"trace_id": trace_id, "kind": kind, "pipeline": pipeline, "created_at": datetime.now(UTC).isoformat().replace("+00:00", "Z"), "duration_ms": 12.5, "input": {"query": query}, "steps": [], "output": {}}


def test_stats_aggregate_events_and_feedback(client, admin, app):
    log = app.state.container.event_log
    log.record_search("t1", "Red Shoes", "hybrid", "search.hybrid", 10.0, 5, {"brand": ["Acme"]})
    log.record_search("t2", "red shoes", "hybrid", "search.hybrid", 30.0, 0, None)
    log.record_search("t3", "lamp", "bm25", "search.bm25", 5.0, 3, None)
    log.record_chat("t4", "s1", "product_question", 900.0, True, query="is it waterproof?")
    log.record_chat("t5", "s1", "policy_question", 1100.0, False)
    log.record_click("t1", "P1", 2)
    assert client.post("/api/v1/feedback", json={"target": "search", "trace_id": "t1", "rating": 1}).status_code == 201
    assert client.post("/api/v1/feedback", json={"target": "answer", "trace_id": "t4", "rating": -1, "comment": "wrong"}).status_code == 201

    body = client.get("/api/v1/admin/stats?days=7", headers=admin).json()
    totals = body["totals"]
    assert totals["searches"] == 3 and totals["chats"] == 2
    assert totals["feedback_positive"] == 1 and totals["feedback_negative"] == 1
    assert totals["zero_result_rate"] == round(1 / 3, 4) and totals["abstain_rate"] == 0.5
    assert totals["clicks"] == 1 and totals["ctr"] == round(1 / 3, 4)
    assert body["latency"]["search.hybrid"] == {"p50": 10.0, "p95": 30.0, "count": 2}
    assert len(body["daily"]) == 7 and body["daily"][-1]["searches"] == 3 and body["daily"][-1]["chats"] == 2
    assert body["top_queries"][0] == {"query": "red shoes", "count": 2}
    assert body["zero_result_queries"] == [{"query": "red shoes", "count": 1}]
    assert client.get("/api/v1/admin/stats?days=0", headers=admin).status_code == 422


def test_traces_list_searches_the_database_store(client, admin, app):
    store = app.state.container.trace_store
    store.save(_trace("trace-a", "leather boots"))
    store.save(_trace("trace-b", "policy question", kind="rag", pipeline="rag.answer"))
    body = client.get("/api/v1/admin/traces", headers=admin).json()
    assert body["total"] == 2
    assert set(body["items"][0]) == {"trace_id", "kind", "pipeline", "created_at", "duration_ms", "input_summary"}
    filtered = client.get("/api/v1/admin/traces?q=boots", headers=admin).json()
    assert [item["trace_id"] for item in filtered["items"]] == ["trace-a"] and filtered["items"][0]["input_summary"] == "leather boots"
    assert client.get("/api/v1/admin/traces?kind=rag", headers=admin).json()["total"] == 1
    assert client.get("/api/v1/admin/traces?limit=1&offset=1", headers=admin).json()["total"] == 2


class FakeIndices:
    def exists_alias(self, name):
        return name != "reviews"

    def get_alias(self, name):
        return {"products_v2": {"aliases": {name: {}}}} if name == "products" else {"policies_v3": {}}

    def get_mapping(self, index):
        meta = {"embedding_identity": {"text_vector": {"model": "google/siglip2-base-patch16-224", "model_revision": "75de2d55ec", "dimension": 768}}}
        return {"x": {"mappings": {"_meta": meta, "properties": {"text_vector": {"type": "dense_vector", "dims": 768}, "title": {"type": "text"}}}}}


class FakeES:
    indices = FakeIndices()

    def count(self, index):
        return {"count": 1500 if index == "products" else 6}


def test_indexes_report_alias_details_and_unavailable_es(client, admin, app):
    body = client.get("/api/v1/admin/indexes", headers=admin).json()
    assert {item["alias"] for item in body["items"]} == {"products", "reviews", "policies"}
    assert all(item["status"] == "unavailable" for item in body["items"])
    app.state.container.provide("es_client", FakeES())
    items = {item["alias"]: item for item in client.get("/api/v1/admin/indexes", headers=admin).json()["items"]}
    assert items["products"]["index"] == "products_v2" and items["products"]["doc_count"] == 1500
    assert items["products"]["vector_fields"] == {"text_vector": 768}
    assert items["products"]["embedder_ids"] == ["siglip2-base-patch16-224@75de2d5"]
    assert items["reviews"]["status"] == "missing"


def test_feedback_list_filters(client, admin):
    for rating, target in ((1, "search"), (-1, "answer"), (1, "answer")):
        client.post("/api/v1/feedback", json={"target": target, "trace_id": "t", "rating": rating, "query": "q"})
    body = client.get("/api/v1/admin/feedback?limit=2", headers=admin).json()
    assert body["total"] == 3 and len(body["items"]) == 2
    assert set(body["items"][0]) >= {"id", "target", "trace_id", "rating", "query", "product_id", "comment", "created_at"}
    assert client.get("/api/v1/admin/feedback?rating=-1", headers=admin).json()["total"] == 1
    assert client.get("/api/v1/admin/feedback?target=answer", headers=admin).json()["total"] == 2


def _write_run(root, rel, payload, config_yaml=None):
    run = root / rel
    run.mkdir(parents=True)
    (run / "metrics.json").write_text(json.dumps(payload), encoding="utf-8")
    (run / "summary.md").write_text("# summary", encoding="utf-8")
    if config_yaml:
        (run / "config.yaml").write_text(config_yaml, encoding="utf-8")


def test_eval_runs_import_list_and_detail(client, admin, config, annotator):
    root = __import__("pathlib").Path(config.jobs.runs_dir)
    _write_run(root, "a1/20261011T100000Z_bm25", {"run_id": "x", "created_at": "2026-10-11T10:00:00Z", "experiment_name": "bm25", "metrics": {"Recall@10": 0.5, "nDCG@10": 0.4, "MRR@10": 0.3}, "latency_ms": {"p50": 5, "p95": 9}}, "experiment:\n  name: bm25\nretrieval:\n  mode: bm25\n")
    _write_run(root, "a3/20261014T120000123456Z_s3", {"experiment_name": "s3", "case_count": 5, "label_statuses": ["seed"], "config": {"experiment": {"name": "s3"}}, "metrics": {"context_recall": 0.7, "citation_precision": None}})
    (root / "broken").mkdir(parents=True)
    (root / "broken" / "metrics.json").write_text("{not json", encoding="utf-8")
    assert client.post("/api/v1/admin/eval-runs/import", headers=annotator).status_code == 403
    imported = client.post("/api/v1/admin/eval-runs/import", headers=admin).json()
    assert imported["imported"] == 2
    assert client.post("/api/v1/admin/eval-runs/import", headers=admin).json()["imported"] == 2  # idempotent upsert
    items = client.get("/api/v1/admin/eval-runs", headers=admin).json()["items"]
    assert [(item["name"], item["kind"]) for item in items] == [("s3", "a3"), ("bm25", "a1")]
    a1 = next(item for item in items if item["kind"] == "a1")
    assert a1["metrics"]["Recall@10"] == 0.5 and a1["config"]["retrieval"]["mode"] == "bm25" and a1["created_at"] == "2026-10-11T10:00:00Z"
    detail = client.get(f"/api/v1/admin/eval-runs/{a1['id']}", headers=admin).json()
    assert detail["summary"] == "# summary" and detail["details"]["latency_ms"] == {"p50": 5, "p95": 9}
    assert client.get("/api/v1/admin/eval-runs?kind=a3", headers=admin).json()["items"][0]["name"] == "s3"
    assert client.get("/api/v1/admin/eval-runs/999", headers=admin).json()["error"]["code"] == "eval_run_not_found"


def test_policy_cms_crud_publish_and_export(client, admin, app, monkeypatch, tmp_path):
    from shopmind.infrastructure.db.policies import PolicyRepository
    from shopmind.infrastructure.jobs.runner import JobContext

    calls = []
    monkeypatch.setattr(JobContext, "run_module", lambda self, module, args=(), **kw: calls.append((module, list(args))) or 0)
    created = client.post("/api/v1/admin/policies", headers=admin, json={"title": "Return window", "section_id": "returns.window", "policy_type": "returns", "version": 1, "content": "30 days."})
    assert created.status_code == 201
    policy = created.json()
    assert policy["status"] == "draft" and policy["policy_id"] == "returns"
    invalid = client.post("/api/v1/admin/policies", headers=admin, json={"title": "", "section_id": "x.y", "content": ""})
    assert invalid.status_code == 422 and {item["field"] for item in invalid.json()["error"]["details"]} == {"title", "content"}
    assert client.post("/api/v1/admin/policies", headers=admin, json={"title": "dup", "section_id": "returns.window", "content": "c"}).status_code == 409
    assert client.put("/api/v1/admin/policies/999", headers=admin, json={"title": "x"}).status_code == 404

    published = client.post("/api/v1/admin/policies/publish", headers=admin, json={})
    assert published.status_code == 200
    job_id = published.json()["job_id"]
    job = app.state.container.job_runner.wait(job_id)
    assert job["status"] == "succeeded", job["log"]
    assert job["result"]["index_name"] == "policies_a3_v1" and job["result"]["switched"] is True
    assert [module for module, _ in calls] == ["scripts.generate_knowledge_embeddings", "scripts.index_policies"]
    assert "--switch-alias" in calls[1][1] and "policies_a3_v1" in calls[1][1]

    # Edit the published section: the draft keeps serving the published text until republished.
    edited = client.put(f"/api/v1/admin/policies/{policy['id']}", headers=admin, json={"content": "14 days."}).json()
    assert edited["status"] == "draft"
    repository = PolicyRepository(app.state.container.db)
    export = tmp_path / "export.jsonl"
    repository.export_jsonl(export)
    sections = load_policy_sections(export)
    assert sections[0].content == "30 days." and sections[0].version == "v1"
    again = client.post("/api/v1/admin/policies/publish", headers=admin, json={"ids": [policy["id"]]}).json()
    assert again["published"][0]["version"] == 2
    app.state.container.job_runner.wait(again["job_id"])
    repository.export_jsonl(export)
    assert load_policy_sections(export)[0].content == "14 days."
    assert app.state.container.job_runner.get(again["job_id"])["result"]["index_name"] == "policies_a3_v2"
    listing = client.get("/api/v1/admin/policies", headers=admin).json()["items"]
    assert listing[0]["version"] == 2 and listing[0]["status"] == "published"
