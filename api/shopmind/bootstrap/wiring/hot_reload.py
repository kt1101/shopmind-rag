"""Apply admin config changes without a restart (hot-reloadable keys only).

``config_service`` notifies subscribers when the active profile changes. Search pipelines are
re-read from the new ``pipelines``/``defaults`` (steps are rebuilt on next use) and the RAG
service is rebuilt from the new ``rag`` section; loaded models and clients are reused.
"""
from __future__ import annotations

import logging

ORDER = 96
CRITICAL = False
LIGHTWEIGHT = True

logger = logging.getLogger("shopmind.bootstrap")


def apply_config(container, config) -> None:
    container.config = config
    factory = container.get("pipelines")
    if factory is not None:
        factory.specs = dict(config.pipelines)
        factory.invalidate()
    search = container.get("search_service")
    if search is not None and hasattr(search, "routes"):
        from shopmind.application.search.service import DEFAULT_MODE_PIPELINES

        search.routes = {**DEFAULT_MODE_PIPELINES, **{key.removeprefix("mode."): value for key, value in config.defaults.items() if key.startswith("mode.")}}
    rag = container.get("rag_service")
    if rag is not None and container.get("knowledge_embedder") is not None and search is not None:
        from shopmind.application.rag.service import create_rag_service

        rebuilt = create_rag_service(search, container.get("es_client"), container.get("knowledge_embedder"), config.rag, review_index_alias=config.index_alias("reviews"), policy_index_alias=config.index_alias("policies"), prompts=container.get("prompts"))
        container.provide("rag_service", rebuilt)
        for name, attribute in (("chat_service", "rag_service"), ("compare_service", "rag")):
            service = container.get(name)
            if service is not None:
                setattr(service, attribute, rebuilt)
    logger.info("runtime config applied (pipelines and RAG rebuilt)")


def wire(container) -> None:
    service = container.get("config_service")
    if service is None or not hasattr(service, "subscribe"):
        return
    service.subscribe(lambda config: apply_config(container, config))
