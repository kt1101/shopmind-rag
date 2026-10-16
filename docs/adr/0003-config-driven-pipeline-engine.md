# ADR 0003: Config-driven pipeline engine with a component registry

- Status: Accepted
- Date: 2026-10-16
- Related: [REFACTOR_PLAN.md](../REFACTOR_PLAN.md) §1.3, §3.4, §5.1

## Context

Runtime wiring is hand-written in `main.py::_wire_runtime`: the embedder is always SigLIP2, A1 always
uses `NoOpReranker`, the LLM provider is a `Literal["openai"]`, index aliases and prompts are constants in
code, and `configs/retrieval.yaml` duplicates keys of `configs/app.yaml`. A1 and A3 also have two parallel
fusion/reranker modules (`retrieval/` for `SearchResult`, `rag/` for `RetrievedDocument`). Changing a
model or adding a step means editing code, and nothing records what each step did, which the glass-box
inspector needs.

## Decision

1. **Registry:** implementations register by kind and name (`@register("retriever", "bm25")`). The
   composition root (`bootstrap/container.py`) builds objects from config by looking them up; nothing else
   instantiates adapters.
2. **Pipelines in YAML:** `pipelines.<name>.steps` lists steps (`step`, `impl`, `id`, `params`, `enabled`,
   `when`). One engine runs A1 search, A3 RAG and evaluation; evaluation overlays modify the same specs.
3. **Tracing built in:** the engine wraps each step in a `StepTrace` (params, timing, capped output,
   notes). Vectors and image bytes are never recorded.
4. **Layered config** with `pydantic-settings`: `configs/base.yaml` → `configs/profiles/<profile>.yaml`
   → environment (`SHOPMIND__` prefix, `__` nesting delimiter) → runtime overrides from the admin
   console (hot-reloadable keys only). All models keep `extra="forbid"`.
5. Prompts, vocabularies and index aliases are files/config entries, not constants.

## Consequences

- Positive: models, retrievers, fusion and rerankers change by YAML; adding a retriever is one class, one
  `@register` line and YAML; every request yields an inspectable trace; runtime and evaluation share code,
  so measured behaviour is shipped behaviour.
- Negative: an indirection layer to learn; config errors move from import time to startup validation
  (mitigated by Pydantic validation and tests that load every shipped config/profile); the migration must
  keep the public API unchanged (existing API tests are the golden tests).
- CI guard `scripts/ci/check_hardcode.sh` rejects physical index names and model ids in application code.

## Alternatives considered

- **Keep manual wiring, add flags:** smallest change, but every new component touches `main.py` and
  tracing must be added by hand per call site.
- **LangChain / LlamaIndex pipelines:** fast to start, but hide retrieval details we need to expose and
  measure, add heavy dependencies and make citation validation harder to control.
- **Dependency-injection framework (e.g. `dependency-injector`):** solves wiring, not pipeline
  declaration or tracing; a small in-house registry is enough.
