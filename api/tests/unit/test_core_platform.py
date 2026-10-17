from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from shopmind.application.pipeline import PipelineContext, PipelineFactory, register_condition, register_step
from shopmind.core.config import AppConfig, PipelineSpec, apply_overrides, load_app_config
from shopmind.core.registry import UnknownComponent, create, register, resolve
from shopmind.core.tracing import current_trace, sanitize, start_trace, trace_step
from shopmind.core.trace_store import InMemoryTraceStore
from shopmind.main import create_app

BASE = "elasticsearch:\n  url: http://localhost:9200\nembedding:\n  model_name: m\nretrieval: {}\nfusion: {}\nreranker: {}\n"


def test_registry_resolves_and_rejects_duplicates():
    @register("test_kind", "a")
    class A:
        def __init__(self, x=1):
            self.x = x

    assert create("test_kind", "a", x=3).x == 3
    with pytest.raises(ValueError):
        register("test_kind", "a")(object)
    with pytest.raises(UnknownComponent, match="registered: a"):
        resolve("test_kind", "missing")


def test_config_layers_base_profile_and_prefixed_env(tmp_path):
    (tmp_path / "profiles").mkdir()
    (tmp_path / "app.yaml").write_text(BASE + "rag:\n  llm:\n    model: base-model\n")
    (tmp_path / "profiles" / "demo.yaml").write_text("retrieval:\n  top_k: 7\n")
    env = {"SHOPMIND__RAG__LLM__TIMEOUT_SECONDS": "12", "SHOPMIND__FEATURES__QUERY_UNDERSTANDING": "llm"}
    from shopmind.core.config import load_config_data

    config = AppConfig.model_validate(load_config_data(tmp_path / "app.yaml", "demo", env))
    assert config.retrieval.top_k == 7
    assert config.rag.llm.model == "base-model"
    assert config.rag.llm.timeout_seconds == 12
    assert config.features.query_understanding == "llm"


def test_runtime_overrides_are_validated(tmp_path):
    (tmp_path / "app.yaml").write_text(BASE)
    config = load_app_config(tmp_path / "app.yaml", profile="")
    assert apply_overrides(config, {"fusion.rrf_k": 10}).fusion.rrf_k == 10
    with pytest.raises(Exception):
        apply_overrides(config, {"fusion.rrf_k": -1})


def test_sanitize_drops_vectors_bytes_and_secrets():
    cleaned = sanitize({"text_vector": [0.1] * 768, "api_key": "x", "raw": b"abc", "values": [0.5] * 100, "ok": 1})
    assert cleaned == {"raw": "<3 bytes>", "values": {"dims": [100]}, "ok": 1}


def test_trace_steps_record_timing_items_and_errors():
    with start_trace("p", kind="search", trace_id="t1", input={"query": "q"}) as trace:
        with trace_step("retrieve", impl="bm25", id="lexical") as step:
            step.set_items([{"id": str(i), "rank": i} for i in range(30)], total=30)
            step.note("hello")
        with pytest.raises(RuntimeError):
            with trace_step("fuse", impl="rrf"):
                raise RuntimeError("boom")
    data = trace.to_dict()
    assert current_trace() is None
    assert [s["id"] for s in data["steps"]] == ["lexical", "fuse"]
    assert len(data["steps"][0]["output"]["items"]) == 20 and data["steps"][0]["output"]["total"] == 30
    assert data["steps"][1]["status"] == "error" and data["steps"][1]["error"] == "RuntimeError"


def test_trace_step_is_noop_without_active_trace():
    with trace_step("retrieve") as step:
        step.set_items([{"id": "x"}])
    assert step.output == {}


def test_pipeline_engine_runs_enabled_steps_with_conditions():
    @register_step("test_append", "value")
    def _factory(spec, services):
        def run(ctx, trace):
            ctx.results.append(spec.params["value"])
            trace.set_summary(f"appended {spec.params['value']}")
        return run

    @register_condition("test_has_query")
    def _has_query(ctx):
        return bool(ctx.request.get("query"))

    spec = PipelineSpec.model_validate({"steps": [
        {"step": "test_append", "impl": "value", "id": "one", "params": {"value": 1}},
        {"step": "test_append", "impl": "value", "id": "two", "params": {"value": 2}, "enabled": False},
        {"step": "test_append", "impl": "value", "id": "three", "params": {"value": 3}, "when": "test_has_query"},
    ]})
    factory = PipelineFactory({"p": spec}, services=None)
    with start_trace("p", kind="search", trace_id="t") as trace:
        ctx = factory.get("p").run(PipelineContext(request={"query": "x"}))
    assert ctx.results == [1, 3]
    assert [s.id for s in trace.steps] == ["one", "three"]
    assert factory.get("p").run(PipelineContext(request={})).results == [1]


def test_memory_trace_store_is_bounded_and_searchable():
    store = InMemoryTraceStore(capacity=2)
    for i in range(3):
        store.save({"trace_id": f"t{i}", "kind": "search", "input": {"query": f"q{i}"}})
    assert store.get("t0") is None
    total, items = store.list(q="q2")
    assert total == 1 and items[0]["trace_id"] == "t2"


def test_trace_and_meta_endpoints():
    app = create_app(auto_wire=False)
    with TestClient(app) as client:
        app.state.trace_store.save({"trace_id": "abc", "kind": "search"})
        assert client.get("/api/v1/traces/abc").json()["trace_id"] == "abc"
        missing = client.get("/api/v1/traces/nope")
        assert missing.status_code == 404 and missing.json()["error"]["code"] == "trace_not_found"
        assert "pipelines" in client.get("/api/v1/meta/pipelines").json()
