"""Admin jobs (``job_runner``) + first-run data: policy CMS seed and eval-run import.

Startup work that touches the filesystem/database runs on a daemon thread so it never delays
``/health``. Nothing here runs against the in-memory fallback database.
"""
from __future__ import annotations

import logging
import threading

ORDER = 95
CRITICAL = False
LIGHTWEIGHT = True

logger = logging.getLogger("shopmind.bootstrap.jobs")


def _startup(container) -> None:
    from shopmind.infrastructure.db.eval_runs import EvalRunRepository
    from shopmind.infrastructure.db.policies import PolicyRepository

    config = container.config
    runner = container.get("job_runner")
    try:
        if runner is not None and (count := runner.recover()):
            logger.info("marked %d interrupted job(s) as failed", count)
        if config.database.seed_policies:
            repository = PolicyRepository(container.db)
            if repository.count() == 0 and (added := repository.seed_from(config.jobs.policies_source)):
                logger.info("seeded %d policy sections into the CMS", added)
        if config.jobs.import_runs_on_startup:
            imported = EvalRunRepository(container.db).import_dir(config.jobs.runs_dir)
            if imported:
                logger.info("imported %d eval run(s) from %s", len(imported), config.jobs.runs_dir)
    except Exception as exc:  # database down or unreadable files: admin features degrade
        logger.warning("platform startup tasks skipped: %s", exc)


def wire(container) -> None:
    from shopmind.infrastructure.jobs import builtin  # noqa: F401  (registers built-in job types)
    from shopmind.infrastructure.jobs.runner import JobRunner

    config = container.config
    if container.get("job_runner") is None and config.jobs.enabled:
        container.provide("job_runner", JobRunner(container.db, container=container, max_workers=config.jobs.max_workers, log_tail_chars=config.jobs.log_tail_chars, timeout_seconds=config.jobs.timeout_seconds))
    if container.db.enabled:
        threading.Thread(target=_startup, args=(container,), name="shopmind-platform-startup", daemon=True).start()
