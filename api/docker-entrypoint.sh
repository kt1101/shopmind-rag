#!/bin/sh
# Container entrypoint for the ShopMind API image.
#
# Database migrations run only when the container starts the web server
# (`uvicorn ...`) or when RUN_MIGRATIONS=1, so one-off jobs such as
# `docker compose run --rm tools python -m scripts.generate_embeddings ...`
# do not need PostgreSQL.
#
#   RUN_MIGRATIONS=1      force migrations for any command
#   SKIP_MIGRATIONS=1     never run migrations
#   MIGRATIONS_STRICT=1   exit if `alembic upgrade head` fails (default: log and continue,
#                         so /health stays up and /ready reports the database problem)
set -eu

run_migrations() {
    if [ ! -f alembic.ini ]; then
        echo "[entrypoint] skip migrations: alembic.ini not found"
        return 0
    fi
    echo "[entrypoint] alembic upgrade head"
    if alembic upgrade head; then
        return 0
    fi
    if [ "${MIGRATIONS_STRICT:-0}" = "1" ]; then
        echo "[entrypoint] migrations failed (MIGRATIONS_STRICT=1), exiting" >&2
        exit 1
    fi
    echo "[entrypoint] migrations failed, continuing without them" >&2
}

if [ "${SKIP_MIGRATIONS:-0}" != "1" ]; then
    if [ "${RUN_MIGRATIONS:-0}" = "1" ] || [ "${1:-}" = "uvicorn" ]; then
        run_migrations
    fi
fi

exec "$@"
