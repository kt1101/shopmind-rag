"""In-process background jobs (component ``job_runner``), persisted in the ``jobs`` table.

A job type is any callable registered with ``@register("job", "<type>")`` taking a ``JobContext``
and returning an optional result dict; raising marks the job ``failed``. Jobs run on a small
thread pool; offline scripts are wrapped with ``ctx.run_module(...)`` (``sys.executable -m``),
whose stdout/stderr stream into the job log (tail-limited).
"""
from __future__ import annotations

import logging
import os
import subprocess
import sys
import threading
import time
from collections.abc import Callable, Sequence
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sqlalchemy import select, update

from shopmind.core.registry import available, resolve
from shopmind.infrastructure.db.engine import Database, iso
from shopmind.infrastructure.db.models import Job

logger = logging.getLogger("shopmind.jobs")

STATUSES = ("queued", "running", "succeeded", "failed")


class UnknownJobType(ValueError):
    pass


class JobNotFound(LookupError):
    pass


class JobFailed(RuntimeError):
    """Raised by job code for an expected, already-logged failure (no traceback in the log)."""


def job_dict(row: Job) -> dict[str, Any]:
    return {"id": row.id, "type": row.type, "status": row.status, "params": dict(row.params or {}), "log": row.log or "", "result": row.result, "error": row.error, "created_by": row.created_by, "created_at": iso(row.created_at), "started_at": iso(row.started_at), "finished_at": iso(row.finished_at)}


def _tail(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    cut = text[-limit:]
    newline = cut.find("\n")
    return "[… earlier output truncated …]\n" + (cut[newline + 1:] if 0 <= newline < 200 else cut)


class JobContext:
    def __init__(self, runner: JobRunner, job_id: int, job_type: str, params: dict[str, Any], created_by: str | None) -> None:
        self.runner = runner
        self.job_id = job_id
        self.type = job_type
        self.params = params
        self.created_by = created_by
        self.container = runner.container
        self.config = runner.config
        self.started_at = datetime.now(UTC)
        self._log: list[str] = []
        self._size = 0
        self._flushed_at = 0.0
        self._lock = threading.Lock()

    @property
    def log_text(self) -> str:
        with self._lock:
            return _tail("\n".join(self._log), self.runner.log_tail_chars)

    def log(self, line: str) -> None:
        text = str(line).rstrip("\n")
        with self._lock:
            self._log.append(text)
            self._size += len(text) + 1
            if self._size > self.runner.log_tail_chars * 2:  # keep memory bounded on chatty scripts
                joined = _tail("\n".join(self._log), self.runner.log_tail_chars)
                self._log = [joined]
                self._size = len(joined)
        if time.monotonic() - self._flushed_at > 1.0:
            self.flush_log()

    def flush_log(self) -> None:
        self._flushed_at = time.monotonic()
        self.runner.update(self.job_id, log=self.log_text)

    def run_module(self, module: str, args: Sequence[str] = (), *, timeout: float | None = None, cwd: str | Path | None = None, env: dict[str, str] | None = None) -> int:
        """Run ``python -m module args`` and stream its output into the job log. Raises ``JobFailed`` on non-zero exit."""
        command = [sys.executable, "-u", "-m", module, *[str(arg) for arg in args]]
        self.log("$ python -m " + " ".join([module, *[str(arg) for arg in args]]))
        merged_env = {**os.environ, "PYTHONUNBUFFERED": "1", "PYTHONIOENCODING": "utf-8", **(env or {})}
        timeout = timeout or self.runner.timeout_seconds
        try:
            process = subprocess.Popen(command, cwd=str(cwd or self.runner.cwd), env=merged_env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace", bufsize=1)
        except OSError as exc:
            self.log(f"ERROR: could not start {module}: {exc}")
            raise JobFailed(f"could not start {module}") from exc
        timer = threading.Timer(timeout, process.kill)
        timer.start()
        try:
            assert process.stdout is not None
            for line in process.stdout:
                self.log(line)
            code = process.wait()
        finally:
            timer.cancel()
        if code != 0:
            self.log(f"ERROR: {module} exited with code {code}")
            raise JobFailed(f"{module} exited with code {code}")
        return code


class JobRunner:
    def __init__(self, db: Database, *, container: Any = None, config: Any = None, max_workers: int = 2, log_tail_chars: int = 20000, timeout_seconds: float = 3600, cwd: str | Path = ".") -> None:
        self.db = db
        self.container = container
        self.config = config if config is not None else getattr(container, "config", None)
        self.max_workers = max_workers
        self.log_tail_chars = log_tail_chars
        self.timeout_seconds = timeout_seconds
        self.cwd = Path(cwd)
        self._executor: ThreadPoolExecutor | None = None
        self._executor_lock = threading.Lock()
        self._futures: dict[int, Any] = {}

    @property
    def types(self) -> list[str]:
        return list(available("job"))

    def _pool(self) -> ThreadPoolExecutor:
        with self._executor_lock:
            if self._executor is None:
                self._executor = ThreadPoolExecutor(max_workers=self.max_workers, thread_name_prefix="shopmind-job")
            return self._executor

    def recover(self) -> int:
        """Mark jobs left ``queued``/``running`` by a previous process as failed."""
        with self.db.session() as session:
            result = session.execute(update(Job).where(Job.status.in_(("queued", "running"))).values(status="failed", error="interrupted by an API restart", finished_at=datetime.now(UTC)))
            return int(result.rowcount or 0)

    def submit(self, job_type: str, params: dict[str, Any] | None = None, *, created_by: str | None = None) -> dict[str, Any]:
        if job_type not in self.types:
            raise UnknownJobType(f"unknown job type {job_type!r} (available: {', '.join(self.types) or 'none'})")
        params = dict(params or {})
        with self.db.session() as session:
            row = Job(type=job_type, status="queued", params=params, log="Queued", created_by=created_by, created_at=datetime.now(UTC))
            session.add(row)
            session.flush()
            job = job_dict(row)
        self._futures[job["id"]] = self._pool().submit(self._execute, job["id"], job_type, params, created_by)
        return job

    def update(self, job_id: int, **values: Any) -> None:
        try:
            with self.db.session() as session:
                session.execute(update(Job).where(Job.id == job_id).values(**values))
        except Exception:
            logger.warning("could not update job %s", job_id, exc_info=True)

    def _execute(self, job_id: int, job_type: str, params: dict[str, Any], created_by: str | None) -> None:
        ctx = JobContext(self, job_id, job_type, params, created_by)
        self.update(job_id, status="running", started_at=ctx.started_at, log="Started")
        ctx.log("Started")
        try:
            handler: Callable[[JobContext], dict[str, Any] | None] = resolve("job", job_type)
            result = handler(ctx)
            ctx.log("Done")
            self.update(job_id, status="succeeded", result=result if isinstance(result, dict) else None, log=ctx.log_text, finished_at=datetime.now(UTC))
        except JobFailed as exc:
            ctx.log(f"Failed: {exc}")
            self.update(job_id, status="failed", error=str(exc), log=ctx.log_text, finished_at=datetime.now(UTC))
        except Exception as exc:
            logger.exception("job %s (%s) failed", job_id, job_type)
            ctx.log(f"ERROR: {type(exc).__name__}: {exc}")
            self.update(job_id, status="failed", error=f"{type(exc).__name__}: {exc}", log=ctx.log_text, finished_at=datetime.now(UTC))
        finally:
            self._futures.pop(job_id, None)

    def wait(self, job_id: int, timeout: float = 30.0) -> dict[str, Any]:
        future = self._futures.get(job_id)
        if future is not None:
            future.result(timeout=timeout)
        return self.get(job_id)

    def get(self, job_id: int) -> dict[str, Any]:
        with self.db.session() as session:
            row = session.get(Job, int(job_id))
            if row is None:
                raise JobNotFound(f"job {job_id} not found")
            return job_dict(row)

    def list(self, *, limit: int = 50, offset: int = 0, job_type: str | None = None, status: str | None = None) -> list[dict[str, Any]]:
        with self.db.session() as session:
            statement = select(Job)
            if job_type:
                statement = statement.where(Job.type == job_type)
            if status:
                statement = statement.where(Job.status == status)
            return [job_dict(row) for row in session.scalars(statement.order_by(Job.id.desc()).offset(offset).limit(limit))]

    def shutdown(self, wait: bool = False) -> None:
        with self._executor_lock:
            if self._executor is not None:
                self._executor.shutdown(wait=wait, cancel_futures=True)
                self._executor = None
