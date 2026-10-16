# ADR 0002: PostgreSQL as the system of record

- Status: Accepted
- Date: 2026-10-16
- Related: [REFACTOR_PLAN.md](../REFACTOR_PLAN.md) §6.1, §6.3

## Context

Elasticsearch is the only datastore today. The product needs durable, relational, transactional data
that is not a search document: admin users, chat sessions, search events, pipeline traces, feedback,
relevance judgments, versioned runtime config with rollback, a policy CMS with draft/published states,
background jobs and evaluation runs. Storing these in Elasticsearch would mean no transactions, no
foreign keys, awkward migrations and mixing the search read model with business state.

## Decision

Add **PostgreSQL 16** as the system of record, accessed through **SQLAlchemy 2** (sync) with **Alembic**
migrations. Elasticsearch stays the search store (read model) rebuilt from offline artifacts.

- Compose service `postgres` (`postgres:16-alpine`, healthcheck, named volume `pgdata`); the API gets
  `DATABASE_URL=postgresql+psycopg://...@postgres:5432/shopmind` and waits for it to be healthy.
- Migrations live in `api/shopmind/infrastructure/db/migrations/` with `api/alembic.ini`; the API image
  runs `alembic upgrade head` before starting uvicorn.
- Tests use SQLite through the same SQLAlchemy models (no async driver needed).
- Trace JSON is stored as JSONB with a configurable retention.

## Consequences

- Positive: transactions, constraints and migrations for business data; admin features (config rollback,
  policy publish → reindex job, judgments → qrels export) become straightforward; the database can be
  inspected with standard tools.
- Negative: one more service to run, back up and keep healthy; schema changes need migrations; SQLite in
  tests does not cover PostgreSQL-specific behaviour (JSONB operators), so such queries need an
  integration test.
- If the database is down, search must keep working: database-backed features degrade and `/ready`
  reports `database` as failing.

## Alternatives considered

- **Elasticsearch only:** no transactions or relations, mixes read model and state.
- **SQLite file:** simple, but weak under concurrent writers and does not match a production setup.
- **MongoDB / document store:** flexible JSON, but relations (users, judgments, profiles) and migrations
  are a better fit for a relational schema; PostgreSQL JSONB covers the document-shaped parts (traces).
