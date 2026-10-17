from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

from shopmind.core.registry import register
from shopmind.infrastructure.jobs.builtin import safe_relative_path
from shopmind.infrastructure.jobs.runner import JobContext, JobFailed


@register("job", "test_echo", replace=True)
def _echo(ctx):
    for index in range(3):
        ctx.log(f"line {index}")
    return {"echo": ctx.params.get("value")}


@register("job", "test_boom", replace=True)
def _boom(ctx):
    ctx.log("about to fail")
    raise RuntimeError("boom")


@register("job", "test_subprocess", replace=True)
def _subprocess(ctx):
    path = Path(ctx.params["path"])
    ctx.run_module("json.tool", [path.as_posix()])
    return {"ok": True}


def test_runner_executes_registered_job_types(app):
    runner = app.state.container.job_runner
    assert {"reindex_policies", "run_eval", "build_embedding_map", "test_echo"} <= set(runner.types)
    job = runner.submit("test_echo", {"value": 42}, created_by="tester")
    assert job["status"] == "queued" and job["created_by"] == "tester"
    done = runner.wait(job["id"])
    assert done["status"] == "succeeded" and done["result"] == {"echo": 42}
    assert "line 2" in done["log"] and done["finished_at"] and done["started_at"]
    failed = runner.wait(runner.submit("test_boom")["id"])
    assert failed["status"] == "failed" and "RuntimeError: boom" in failed["log"] and failed["error"] == "RuntimeError: boom"


def test_run_module_streams_subprocess_output_and_fails_cleanly(app, tmp_path):
    runner = app.state.container.job_runner
    good = tmp_path / "ok.json"
    good.write_text(json.dumps({"hello": "world"}), encoding="utf-8")
    job = runner.wait(runner.submit("test_subprocess", {"path": str(good)})["id"], timeout=60)
    assert job["status"] == "succeeded" and '"hello": "world"' in job["log"]
    bad = tmp_path / "bad.json"
    bad.write_text("{nope", encoding="utf-8")
    job = runner.wait(runner.submit("test_subprocess", {"path": str(bad)})["id"], timeout=60)
    assert job["status"] == "failed" and "exited with code" in job["log"]


def test_log_is_tail_limited(app):
    runner = app.state.container.job_runner
    runner.log_tail_chars = 200

    @register("job", "test_chatty", replace=True)
    def _chatty(ctx):
        for index in range(500):
            ctx.log(f"output line {index:04d}")

    job = runner.wait(runner.submit("test_chatty")["id"])
    assert len(job["log"]) < 300 and "output line 0499" in job["log"] and "truncated" in job["log"]


def test_jobs_http_endpoints(client, admin, annotator, app):
    started = client.post("/api/v1/admin/jobs", headers=admin, json={"type": "test_echo", "params": {"value": "x"}})
    assert started.status_code == 201
    job_id = started.json()["id"]
    app.state.container.job_runner.wait(job_id)
    detail = client.get(f"/api/v1/admin/jobs/{job_id}", headers=admin).json()
    assert set(detail) >= {"id", "type", "status", "params", "log", "created_at", "finished_at"} and detail["status"] == "succeeded"
    assert client.get("/api/v1/admin/jobs", headers=admin).json()["items"][0]["id"] == job_id
    unknown = client.post("/api/v1/admin/jobs", headers=admin, json={"type": "nope"})
    assert unknown.status_code == 422 and unknown.json()["error"]["code"] == "unknown_job_type"
    assert client.post("/api/v1/admin/jobs", headers=annotator, json={"type": "test_echo"}).status_code == 403
    assert client.get("/api/v1/admin/jobs/9999", headers=admin).json()["error"]["code"] == "job_not_found"


def test_recover_marks_interrupted_jobs_failed(app):
    from shopmind.infrastructure.db.models import Job

    with app.state.container.db.session() as session:
        session.add(Job(type="run_eval", status="running", params={}))
    assert app.state.container.job_runner.recover() == 1


def test_reindex_policies_dry_run_exports_loader_compatible_jsonl(app):
    from shopmind.infrastructure.db.policies import PolicyRepository
    from shopmind.ingestion.policy_loader import load_policy_sections

    repository = PolicyRepository(app.state.container.db)
    assert repository.seed_from(Path("data/policies")) > 0
    runner = app.state.container.job_runner
    job = runner.wait(runner.submit("reindex_policies", {"dry_run": True})["id"])
    assert job["status"] == "succeeded", job["log"]
    sections = load_policy_sections(job["result"]["export"])
    assert len(sections) == job["result"]["policies"] and sections[0].version == "v1"
    assert job["result"]["index_name"] == "policies_a3_v1" and job["result"]["dry_run"] is True


def test_reindex_without_published_policies_fails(app):
    runner = app.state.container.job_runner
    job = runner.wait(runner.submit("reindex_policies", {"dry_run": True})["id"])
    assert job["status"] == "failed" and "no published policies" in job["log"]


def test_run_eval_invokes_runner_and_imports_new_runs(app, monkeypatch):
    calls = []
    runs_dir = Path(app.state.config.jobs.runs_dir)

    def fake_run_module(self, module, args=(), **kwargs):
        calls.append((module, list(args)))
        run = runs_dir / "a1" / "20991231T000000Z_hybrid_rrf"
        run.mkdir(parents=True)
        (run / "metrics.json").write_text(json.dumps({"experiment_name": "hybrid_rrf", "metrics": {"Recall@10": 0.6}}), encoding="utf-8")
        return 0

    monkeypatch.setattr(JobContext, "run_module", fake_run_module)
    runner = app.state.container.job_runner
    job = runner.wait(runner.submit("run_eval", {})["id"])
    assert job["status"] == "succeeded", job["log"]
    module, args = calls[0]
    assert module == "evaluation.runner" and args[:2] == ["--config", "configs/experiments/hybrid_rrf.yaml"]
    assert "--runs-root" in args and "--query-type" in args
    assert len(job["result"]["eval_run_ids"]) == 1
    calls.clear()
    job = runner.wait(runner.submit("run_eval", {"kind": "a3", "configs": ["configs/experiments/rag/s0_bm25_retrieval.yaml"], "cases": "x.jsonl"})["id"])
    assert calls[0][0] == "scripts.run_rag_experiment"
    bad = runner.wait(runner.submit("run_eval", {"config": "../../etc/passwd"})["id"])
    assert bad["status"] == "failed" and "relative path" in bad["error"]


def test_build_embedding_map_reports_missing_script(app, monkeypatch):
    real = importlib.util.find_spec
    monkeypatch.setattr(importlib.util, "find_spec", lambda name, *a: None if name == "scripts.build_embedding_map" else real(name, *a))
    runner = app.state.container.job_runner
    job = runner.wait(runner.submit("build_embedding_map")["id"])
    assert job["status"] == "failed" and "not available" in job["log"]


def test_safe_relative_path():
    assert safe_relative_path("configs/x.yaml", field="f") == "configs/x.yaml"
    for value in ("/etc/passwd", "C:/x", "a/../../b", ""):
        with pytest.raises(JobFailed):
            safe_relative_path(value, field="f")
