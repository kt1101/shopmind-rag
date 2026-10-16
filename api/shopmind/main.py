from __future__ import annotations

import logging
import os
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from shopmind.interfaces.http.errors import ERROR_MAP, lookup_error, register_error
from shopmind.core.config import parse_origins
from shopmind.interfaces.http.routes import discover_routers
from shopmind.interfaces.http.routes.rag import RAGUnavailable
from shopmind.core.logging import configure_logging
from shopmind.infrastructure.llm.base import InvalidLLMOutput, LLMProviderError
from shopmind.application.rag.service import ContextConstructionError, KnowledgeRetrievalUnavailable, RAGGenerationError, RerankerUnavailable

logger = logging.getLogger("shopmind")


def _error_body(request: Request, code: str, message: str) -> dict[str, Any]:
    return {"error": {"code": code, "message": message}, "request_id": getattr(request.state, "request_id", "unknown")}


def _default_config(auto_wire: bool):
    from shopmind.core.config import AppConfig, load_app_config

    if auto_wire:
        return load_app_config(Path(os.getenv("SHOPMIND_CONFIG", "configs/app.yaml")))
    # Lightweight in-process config for tests and fakes: no auth, no database, memory traces.
    return AppConfig.model_validate({"elasticsearch": {"url": "http://localhost:9200"}, "embedding": {"model_name": "unconfigured"}, "retrieval": {}, "fusion": {}, "reranker": {}, "auth": {"enabled": False}, "database": {"enabled": False}})


def _apply_container(app: FastAPI, container) -> None:
    app.state.container = container
    for name, component in container.components.items():
        setattr(app.state, name, component)
    config = container.config
    embedder = container.get("embedder")
    if embedder is not None:
        app.state.embedding_model = getattr(embedder, "model_name", None)
        app.state.embedding_version = getattr(embedder, "model_revision", None)
    if container.critical_errors:
        app.state.runtime_error = next(iter(container.critical_errors.values()))
    if "rag" in container.errors:
        app.state.rag_runtime_error = container.errors["rag"]
    app.state.config = config


def _wire_runtime(app: FastAPI, config=None) -> None:
    from shopmind.bootstrap.container import build_container

    config = config or _default_config(True)
    app.state.index_alias = config.index_alias("products")
    app.state.max_image_bytes = config.api.max_image_bytes
    app.state.fusion_rrf_k = config.fusion.rrf_k
    _apply_container(app, build_container(config))


def create_app(*, search_service: Any | None = None, repository: Any | None = None, embedder: Any | None = None, index_alias: str = "products", max_image_bytes: int = 5 * 1024 * 1024, product_image_dir: str | Path | None = None, rag_service: Any | None = None, catalog_service: Any | None = None, chat_service: Any | None = None, cors_origins: list[str] | None = None, fusion_rrf_k: int = 60, auto_wire: bool = True, config: Any | None = None, components: dict[str, Any] | None = None) -> FastAPI:
    if max_image_bytes <= 0:
        raise ValueError("max_image_bytes must be positive")
    if fusion_rrf_k <= 0:
        raise ValueError("fusion_rrf_k must be positive")

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if auto_wire:
            configure_logging()
        if auto_wire and app.state.search_service is None:
            try:
                _wire_runtime(app, config)
            except Exception as exc:
                logger.exception("runtime initialization failed")
                app.state.runtime_error = exc
        yield

    app = FastAPI(title="ShopMind Multimodal Retrieval", version="0.1.0", lifespan=lifespan)
    app.state.search_service = search_service
    app.state.repository = repository
    app.state.embedder = embedder
    app.state.index_alias = index_alias
    app.state.max_image_bytes = max_image_bytes
    app.state.fusion_rrf_k = fusion_rrf_k
    app.state.embedding_model = getattr(embedder, "model_name", None)
    app.state.embedding_version = getattr(embedder, "model_revision", None)
    app.state.runtime_error = None
    app.state.rag_service = rag_service
    app.state.rag_runtime_error = None
    app.state.catalog_service = catalog_service
    app.state.chat_service = chat_service
    app.state.config = config
    app.state.container = None
    if not auto_wire:
        from shopmind.bootstrap.container import build_container

        injected = {name: value for name, value in {"search_service": search_service, "repository": repository, "embedder": embedder, "rag_service": rag_service, "catalog_service": catalog_service, "chat_service": chat_service}.items() if value is not None}
        app.state.config = config or _default_config(False)
        _apply_container(app, build_container(app.state.config, overrides={**injected, **(components or {})}, lightweight_only=True))
    app.mount("/media/products", StaticFiles(directory=product_image_dir or os.getenv("PRODUCT_IMAGE_DIR", "data/raw/images"), check_dir=False), name="product-images")

    @app.middleware("http")
    async def request_id_middleware(request: Request, call_next):
        request.state.request_id = request.headers.get("X-Request-ID") or uuid.uuid4().hex
        response = await call_next(request)
        response.headers["X-Request-ID"] = request.state.request_id
        return response

    origins = cors_origins if cors_origins is not None else parse_origins(os.getenv("CORS_ORIGINS", ""))
    if origins:
        app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["GET", "POST"], allow_headers=["*"], expose_headers=["X-Request-ID"])

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(request: Request, exc: RequestValidationError):
        del exc
        return JSONResponse(status_code=422, content=_error_body(request, "validation_error", "request validation failed"))

    async def mapped_error_handler(request: Request, exc: Exception):
        status, code = lookup_error(exc) or (500, "internal_error")
        return JSONResponse(status_code=status, content=_error_body(request, code, str(exc)))

    for router in discover_routers():  # importing routers lets them register_error() first
        app.include_router(router)
    for exc_type in list(ERROR_MAP):
        app.add_exception_handler(exc_type, mapped_error_handler)
    return app


for _exc, _status, _code in (
    (RAGUnavailable, 503, "rag_unavailable"),
    (KnowledgeRetrievalUnavailable, 503, "rag_dependency_unavailable"),
    (RerankerUnavailable, 503, "rag_dependency_unavailable"),
    (ContextConstructionError, 503, "rag_dependency_unavailable"),
    (LLMProviderError, 503, "llm_unavailable"),
    (InvalidLLMOutput, 502, "rag_generation_failed"),
    (RAGGenerationError, 502, "rag_generation_failed"),
):
    register_error(_exc, _status, _code)


app = create_app(auto_wire=True)
