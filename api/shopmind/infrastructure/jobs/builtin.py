"""Built-in admin job types. Each wraps existing offline entry points (never re-implements them).

- ``reindex_policies``: export published CMS policies → ``scripts.generate_knowledge_embeddings``
  → ``scripts.index_policies --switch-alias`` into ``<jobs.policy_index_prefix><N+1>``.
- ``run_eval``: ``evaluation.runner`` / ``evaluation.ablation`` (A1) or
  ``scripts.run_rag_experiment`` (A3), then imports the new ``runs/**/metrics.json``.
- ``build_embedding_map``: ``scripts.build_embedding_map --output <dir>``.

Register more with ``@register("job", "<name>")`` on a ``(ctx: JobContext) -> dict | None``.
"""
from __future__ import annotations

import importlib.util
import os
import re
from pathlib import Path, PurePosixPath, PureWindowsPath
from typing import Any

from shopmind.core.registry import register
from shopmind.infrastructure.jobs.runner import JobContext, JobFailed

DEFAULT_A3_CONFIGS = ("configs/experiments/rag/s2_hybrid_retrieval.yaml",)
DEFAULT_A3_CASES = "data/evaluation/rag_cases.jsonl"


def safe_relative_path(value: Any, *, field: str) -> str:
    """Admin-supplied paths must stay inside the API working directory."""
    text = str(value or "").strip()
    if not text:
        raise JobFailed(f"param {field} must not be empty")
    for flavour in (PurePosixPath, PureWindowsPath):
        path = flavour(text)
        if path.is_absolute() or ".." in path.parts or path.drive:
            raise JobFailed(f"param {field} must be a relative path inside the API directory")
    return text


def _app_config_path() -> str:
    return os.environ.get("SHOPMIND_CONFIG", "configs/app.yaml")


def _policy_numbers(ctx: JobContext, prefix: str) -> list[int]:
    pattern = re.compile("^" + re.escape(prefix) + r"(\d+)$")
    numbers: list[int] = []
    client = ctx.container.get("es_client") if ctx.container is not None else None
    if client is not None:
        try:
            names = list(client.indices.get(index=f"{prefix}*", ignore_unavailable=True, allow_no_indices=True).keys())
            numbers += [int(match.group(1)) for name in names if (match := pattern.match(name))]
        except Exception as exc:
            ctx.log(f"warning: could not list existing policy indexes ({type(exc).__name__}); using job history")
    for job in ctx.runner.list(job_type="reindex_policies", status="succeeded", limit=200):
        name = (job.get("result") or {}).get("index_name") or ""
        if match := pattern.match(name):
            numbers.append(int(match.group(1)))
    return numbers


@register("job", "reindex_policies")
def reindex_policies(ctx: JobContext) -> dict[str, Any]:
    from shopmind.infrastructure.db.policies import PolicyRepository

    jobs = ctx.config.jobs
    prefix = jobs.policy_index_prefix
    number = int(ctx.params["version"]) if ctx.params.get("version") else max(_policy_numbers(ctx, prefix), default=0) + 1
    index_name = f"{prefix}{number}"
    work_dir = Path(jobs.work_dir)
    export_path = work_dir / "policies" / f"{index_name}.jsonl"
    embeddings_dir = work_dir / "embeddings" / index_name
    ctx.log(f"Exporting published policies to {export_path.as_posix()}")
    count = PolicyRepository(ctx.runner.db).export_jsonl(export_path)
    if count == 0:
        ctx.log("ERROR: no published policies to index")
        raise JobFailed("no published policies to index")
    ctx.log(f"Exported {count} policy sections")
    alias = ctx.config.index_alias("policies")
    result = {"index_name": index_name, "alias": alias, "policies": count, "export": export_path.as_posix(), "embeddings": embeddings_dir.as_posix(), "switched": False}
    if ctx.params.get("dry_run"):
        ctx.log("dry_run: skipping embedding and indexing")
        return {**result, "dry_run": True}
    config_path = _app_config_path()
    ctx.log(f"Embedding {count} sections into {embeddings_dir.as_posix()}")
    ctx.run_module("scripts.generate_knowledge_embeddings", ["--source", "policy", "--input", export_path.as_posix(), "--dataset-version", index_name, "--output-dir", embeddings_dir.as_posix(), "--config", config_path, "--force"])
    ctx.log(f"Creating index {index_name}, validating, switching alias {alias} -> {index_name}")
    ctx.run_module("scripts.index_policies", ["--input", export_path.as_posix(), "--embeddings", embeddings_dir.as_posix(), "--index-name", index_name, "--alias", alias, "--config", config_path, "--switch-alias"])
    return {**result, "switched": True}


def _import_runs(ctx: JobContext) -> list[int]:
    from shopmind.infrastructure.db.eval_runs import EvalRunRepository

    imported = EvalRunRepository(ctx.runner.db).import_dir(ctx.config.jobs.runs_dir, job_id=ctx.job_id, since=ctx.started_at)
    ctx.log(f"Imported {len(imported)} eval run(s) into the Evaluation Center")
    return imported


@register("job", "run_eval")
def run_eval(ctx: JobContext) -> dict[str, Any]:
    jobs = ctx.config.jobs
    params = ctx.params
    kind = str(params.get("kind") or "a1").lower()
    runs_dir = jobs.runs_dir.rstrip("/")
    if kind == "a3":
        configs = params.get("configs") or ([params["config"]] if params.get("config") else list(DEFAULT_A3_CONFIGS))
        configs = [safe_relative_path(item, field="configs") for item in configs]
        cases = safe_relative_path(params["cases"], field="cases") if params.get("cases") else DEFAULT_A3_CASES
        runs_root = safe_relative_path(params["runs_root"], field="runs_root") if params.get("runs_root") else f"{runs_dir}/a3"
        ctx.run_module("scripts.run_rag_experiment", ["--configs", *configs, "--cases", cases, "--runs-root", runs_root, "--app-config", _app_config_path()])
    elif kind == "a1":
        queries = safe_relative_path(params["queries"], field="queries") if params.get("queries") else jobs.eval_queries
        qrels = safe_relative_path(params["qrels"], field="qrels") if params.get("qrels") else jobs.eval_qrels
        runs_root = safe_relative_path(params["runs_root"], field="runs_root") if params.get("runs_root") else f"{runs_dir}/a1"
        query_type = params.get("query_type", "text")
        extra = ["--query-type", str(query_type)] if query_type in ("text", "image") else []
        configs = params.get("configs")
        if configs:
            configs = [safe_relative_path(item, field="configs") for item in configs]
            ctx.run_module("evaluation.ablation", ["--configs", *configs, "--queries", queries, "--qrels", qrels, "--runs-root", runs_root, *extra])
        else:
            config = safe_relative_path(params["config"], field="config") if params.get("config") else jobs.eval_config
            ctx.run_module("evaluation.runner", ["--config", config, "--queries", queries, "--qrels", qrels, "--runs-root", runs_root, *extra])
    else:
        raise JobFailed(f"unknown eval kind {kind!r} (a1 or a3)")
    return {"kind": kind, "eval_run_ids": _import_runs(ctx)}


@register("job", "build_embedding_map")
def build_embedding_map(ctx: JobContext) -> dict[str, Any]:
    module = "scripts.build_embedding_map"
    if importlib.util.find_spec(module) is None:
        ctx.log(f"ERROR: {module} is not available in this build")
        raise JobFailed(f"{module} is not available")
    output = safe_relative_path(ctx.params["output"], field="output") if ctx.params.get("output") else ctx.config.jobs.embedding_map_output
    extra = [str(arg) for arg in ctx.params.get("args") or []]
    ctx.run_module(module, ["--output", output, *extra])
    return {"output": output}
