"""A3 RAG, chat assistant (F2) and compare (F3) services.

Non-critical: search keeps working when RAG cannot start. Platform components wired by other
modules (``chat_store``, ``commerce``) are looked up lazily, so wiring order does not matter.
"""
from __future__ import annotations

ORDER = 20
CRITICAL = False


class LazyComponent:
    """Resolve a container component on first use; calls are no-ops while it is absent."""

    def __init__(self, container, name: str) -> None:
        self._container = container
        self._name = name

    def __bool__(self) -> bool:
        return self._container.get(self._name) is not None

    def __getattr__(self, attribute: str):
        target = self._container.get(self._name)
        if target is None:
            return lambda *args, **kwargs: None
        return getattr(target, attribute)


def wire(container) -> None:
    config = container.effective_config()
    from shopmind.application.chat.image_cache import ImageTokenCache

    if container.get("image_cache") is None:
        container.provide("image_cache", ImageTokenCache(ttl_seconds=config.features.chat_image_ttl_seconds))
    catalog = container.get("catalog_service")
    if catalog is not None and getattr(catalog, "commerce", "absent") is None:
        catalog.commerce = LazyComponent(container, "commerce")
    if not config.rag.enabled or container.get("rag_service") is not None or container.get("search_service") is None:
        return
    from shopmind.application.chat.intents import LLMQueryUnderstanding, RuleQueryUnderstanding
    from shopmind.application.chat.service import ChatService
    from shopmind.application.rag.compare import CompareService
    from shopmind.application.rag.service import create_rag_service
    from shopmind.infrastructure.elasticsearch.knowledge_repository import ElasticsearchKnowledgeRepository
    from shopmind.infrastructure.embedding.factory import build_embedder, field_embedder_ids
    from shopmind.infrastructure.llm.prompts import PromptLibrary

    client = container.get("es_client")
    embedders = container.get("embedders") or {}
    knowledge_id = field_embedder_ids(config, "policies").get("text_vector")
    knowledge_embedder = embedders.get(knowledge_id) or (build_embedder(config, knowledge_id) if knowledge_id else container.get("embedder"))
    embedders.setdefault(knowledge_id, knowledge_embedder)
    container.provide("knowledge_embedder", knowledge_embedder)
    prompts = PromptLibrary(config.prompts)
    container.provide("prompts", prompts)
    rag_service = create_rag_service(container.search_service, client, knowledge_embedder, config.rag, review_index_alias=config.index_alias("reviews"), policy_index_alias=config.index_alias("policies"), prompts=prompts)
    container.provide("rag_service", rag_service)
    repository = container.get("repository")
    catalog_cache: dict[str, list[str]] = {}

    def catalog_values(field: str) -> list[str]:
        if field not in catalog_cache:
            catalog_cache[field] = repository.all_values(field) if hasattr(repository, "all_values") else []
        return catalog_cache[field]

    mode = config.features.query_understanding
    understanding = None
    if mode == "llm" and rag_service.llm is not None:
        understanding = LLMQueryUnderstanding(rag_service.llm, prompts.get("query_understanding").text, catalog_values)
    elif mode != "off":
        understanding = RuleQueryUnderstanding(catalog_values)
    if understanding is not None:
        container.provide("query_understanding", understanding)
    reviews = ElasticsearchKnowledgeRepository(client, config.index_alias("reviews"), source="review")
    container.provide("chat_service", ChatService(rag_service, config.rag.chat, reviews.alias_exists, lambda product_id: (repository.get_product(product_id) or {}).get("title"), understanding=understanding, search=container.search_service, image_cache=container.get("image_cache"), store=LazyComponent(container, "chat_store"), commerce=LazyComponent(container, "commerce")))
    if catalog is not None:
        container.provide("compare_service", CompareService(catalog, rag_service, prompts))
