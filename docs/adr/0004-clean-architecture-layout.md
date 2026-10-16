# ADR 0004: Clean Architecture (ports and adapters) package layout

- Status: Accepted
- Date: 2026-10-16
- Related: [REFACTOR_PLAN.md](../REFACTOR_PLAN.md) §3.2, [architecture.md](../architecture.md)

## Context

`api/shopmind/app/` mixes HTTP concerns, use-case logic and Elasticsearch/torch/OpenAI details in the
same modules. `create_app` takes 13 keyword arguments and spreads state over `app.state.*`; about 15
exception handlers repeat the same mapping. The offline pipeline lives in `shopmind/pipeline/`, a name
that will collide with the runtime pipeline engine. Several people will work on the backend in parallel,
so module boundaries need to be explicit.

## Decision

Adopt Clean Architecture / Hexagonal layering under `api/shopmind/`:

```text
domain/          models, ports (Protocols), domain errors     - pure Python
application/     use cases (search, rag, admin, feedback)     - depends on domain only
infrastructure/  adapters: elasticsearch, embedding, llm, rerank, db (SQLAlchemy + Alembic migrations)
interfaces/      http (routers, schemas, deps, errors table, sse), cli
bootstrap/       settings, container (composition root), app factory
ingestion/       offline pipeline (renamed from shopmind/pipeline/)
```

Dependency rule: `interfaces → application → domain ← infrastructure`; only `bootstrap` knows concrete
adapters. Migration is incremental: move one module at a time with tests green, never change an algorithm
in the same step as moving it.

## Consequences

- Positive: framework-free domain and use cases are easy to unit test with fakes (the existing
  `create_app(..., auto_wire=False)` testing style generalises); adapters (ES, OpenAI, Ollama, E5) are
  swappable; parallel work has clear ownership; the error table replaces duplicated handlers.
- Negative: more packages and some boilerplate (ports + adapters); a transition period where old and new
  paths coexist; import paths in scripts, tests and the Docker `CMD` change (the API image entry point
  must follow the new app factory location).
- Layer violations are reviewed in code review; the hard-code guard in CI covers config leaks in
  `domain/`, `application/`, `interfaces/`. An import-linter contract can be added later.

## Alternatives considered

- **Keep the current flat `app/` package:** no migration cost, but coupling keeps growing with admin,
  database and new features.
- **Feature-first (vertical slice) packages:** good for UI and small services, but the shared retrieval
  components (embedders, retrievers, fusion) cut across every feature here.
- **Split into microservices (search, rag, admin):** operational overhead without a scaling need (Won't).
