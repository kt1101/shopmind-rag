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

import contextvars
from collections.abc import Callable, Mapping
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any, Protocol

from shopmind.core.config import PipelineSpec, StepSpec
from shopmind.core.registry import register, resolve
from shopmind.core.tracing import StepTrace, current_trace, trace_step


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


# Steps that only read the request/state and write their own ranking can run concurrently
# (e.g. BM25 and dense retrieval of a hybrid pipeline: total latency = max, not sum).
PARALLEL_STEPS = {"retrieve"}
_POOL = ThreadPoolExecutor(max_workers=8, thread_name_prefix="pipeline-step")


def _run_one(ctx: PipelineContext, spec: StepSpec, step: Step) -> None:
    with trace_step(spec.step, impl=spec.impl, id=spec.key, params=spec.params) as record:
        step(ctx, record)


def _run_parallel(ctx: PipelineContext, group: list[tuple[StepSpec, Step]]) -> None:
    """Run steps on private copies of the context, then merge them in declaration order, so
    rankings, results, trace order and short-circuits (``stop``) match sequential execution."""
    trace = current_trace()
    children = [PipelineContext(request=ctx.request, rankings={}, results=list(ctx.results), state=dict(ctx.state)) for _ in group]
    records: list[StepTrace | None] = [None] * len(group)

    def work(position: int) -> None:
        spec, step = group[position]
        with trace_step(spec.step, impl=spec.impl, id=spec.key, params=spec.params, trace=trace, attach=False) as record:
            records[position] = record
            step(children[position], record)

    futures = [_POOL.submit(contextvars.copy_context().run, work, position) for position in range(len(group))]
    errors = [future.exception() for future in futures]
    for position, child in enumerate(children):
        if trace is not None and records[position] is not None:
            trace.steps.append(records[position])
        if errors[position] is not None:
            raise errors[position]
        ctx.rankings.update(child.rankings)
        ctx.state.update(child.state)
        ctx.results = child.results
        if child.stopped:  # e.g. exact product-id hit: later rankings are discarded, as if never run
            ctx.stop()
            break


class Pipeline:
    def __init__(self, name: str, spec: PipelineSpec, steps: list[tuple[StepSpec, Step]]) -> None:
        self.name = name
        self.spec = spec
        self.steps = steps

    def run(self, ctx: PipelineContext) -> PipelineContext:
        index = 0
        while index < len(self.steps) and not ctx.stopped:
            end = index
            while end < len(self.steps) and self.steps[end][0].step in PARALLEL_STEPS:
                end += 1
            if end - index > 1:  # a run of independent retrieve steps: execute them concurrently
                group = [(spec, step) for spec, step in self.steps[index:end] if not spec.when or resolve("condition", spec.when)(ctx)]
                if len(group) > 1:
                    _run_parallel(ctx, group)
                else:
                    for spec, step in group:
                        _run_one(ctx, spec, step)
                index = end
                continue
            spec, step = self.steps[index]
            if not spec.when or resolve("condition", spec.when)(ctx):
                _run_one(ctx, spec, step)
            index += 1
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
