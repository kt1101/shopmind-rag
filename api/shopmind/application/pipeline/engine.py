"""Generic, traced pipeline engine.

A pipeline is an ordered list of ``StepSpec`` (``configs/*.yaml`` → ``pipelines:``). Each spec is
resolved through the registry under kind ``step`` and name ``"<step>.<impl>"`` (for example
``retrieve.bm25``, ``fuse.rrf``, ``rerank.noop``). Step factories receive the spec and the
services container and return a callable ``step(ctx, trace) -> None`` that reads/writes the
shared ``PipelineContext``. Every step runs inside ``trace_step`` so the glass-box trace is
produced for free.

Conditions (``when:`` in YAML) are registered predicates of kind ``condition``.
"""
from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import Any, Protocol

from shopmind.core.config import PipelineSpec, StepSpec
from shopmind.core.registry import register, resolve
from shopmind.core.tracing import StepTrace, trace_step


@dataclass
class PipelineContext:
    """Mutable state shared by the steps of one pipeline run.

    ``request``  the domain request (``SearchRequest``, ``RAGRequest``, dict, …)
    ``rankings`` named candidate lists produced by retrieve steps (key = step id)
    ``results``  the current ranked list (set by fuse / rerank / single retrieve)
    ``state``    free-form values (query analysis, query vector, context, answer…)
    """
    request: Any
    rankings: dict[str, list[Any]] = field(default_factory=dict)
    results: list[Any] = field(default_factory=list)
    state: dict[str, Any] = field(default_factory=dict)
    stopped: bool = False

    def stop(self) -> None:
        """Short-circuit remaining steps (e.g. exact product-id hit)."""
        self.stopped = True


class Step(Protocol):
    def __call__(self, ctx: PipelineContext, trace: StepTrace) -> None: ...


StepFactory = Callable[[StepSpec, Any], Step]


def register_step(step: str, impl: str) -> Callable[[StepFactory], StepFactory]:
    return register("step", f"{step}.{impl}")


def register_condition(name: str) -> Callable[[Callable[[PipelineContext], bool]], Callable[[PipelineContext], bool]]:
    return register("condition", name)


@register_condition("always")
def _always(ctx: PipelineContext) -> bool:
    return True


class Pipeline:
    def __init__(self, name: str, spec: PipelineSpec, steps: list[tuple[StepSpec, Step]]) -> None:
        self.name = name
        self.spec = spec
        self.steps = steps

    def run(self, ctx: PipelineContext) -> PipelineContext:
        for spec, step in self.steps:
            if ctx.stopped:
                break
            if spec.when and not resolve("condition", spec.when)(ctx):
                continue
            with trace_step(spec.step, impl=spec.impl, id=spec.key, params=spec.params) as record:
                step(ctx, record)
        return ctx

    def describe(self) -> dict[str, Any]:
        return {"name": self.name, "kind": self.spec.kind, "description": self.spec.description, "steps": [{"id": spec.key, "step": spec.step, "impl": spec.impl, "enabled": spec.enabled, "params": spec.params} for spec in self.spec.steps]}


class PipelineFactory:
    """Builds (and caches) pipelines from config specs using the services container."""

    def __init__(self, specs: Mapping[str, PipelineSpec], services: Any) -> None:
        self.specs = dict(specs)
        self.services = services
        self._cache: dict[str, Pipeline] = {}

    def names(self, *, public_only: bool = False) -> list[str]:
        return [name for name, spec in self.specs.items() if spec.public or not public_only]

    def get(self, name: str) -> Pipeline:
        if name not in self._cache:
            if name not in self.specs:
                raise KeyError(f"unknown pipeline {name!r}")
            spec = self.specs[name]
            steps = [(step, resolve("step", f"{step.step}.{step.impl}")(step, self.services)) for step in spec.steps if step.enabled]
            self._cache[name] = Pipeline(name, spec, steps)
        return self._cache[name]

    def invalidate(self) -> None:
        self._cache.clear()
