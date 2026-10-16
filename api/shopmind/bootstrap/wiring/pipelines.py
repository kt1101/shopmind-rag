"""Pipeline factory over ``config.pipelines`` (steps resolve lazily, on first use)."""
from __future__ import annotations

ORDER = 90
CRITICAL = False
LIGHTWEIGHT = True


def wire(container) -> None:
    from shopmind.application.pipeline import PipelineFactory

    container.provide("pipelines", PipelineFactory(container.config.pipelines, container))
