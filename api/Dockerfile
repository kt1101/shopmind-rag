FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# CPU-only torch: the runtime never uses CUDA, and the default PyPI wheel pulls several GB of NVIDIA libraries.
RUN python -m pip install --upgrade pip \
    && python -m pip install --index-url https://download.pytorch.org/whl/cpu "torch>=2.2,<3.0"

# Optional dependency groups from pyproject.toml (comma-separated, may be empty).
ARG API_EXTRAS=text-embed,rag-rerank,viz

# alembic.ini* is a glob so the build still works before the migration setup exists.
COPY pyproject.toml README.md alembic.ini* ./
COPY shopmind ./shopmind
COPY evaluation ./evaluation
COPY scripts ./scripts
COPY configs ./configs

RUN if [ -n "$API_EXTRAS" ]; then target=".[${API_EXTRAS}]"; else target="."; fi \
    && python -m pip install "$target"

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 8000

# Runs `alembic upgrade head` before uvicorn (skipped when alembic.ini is absent), then execs CMD.
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["uvicorn", "shopmind.app.main:app", "--host", "0.0.0.0", "--port", "8000"]
