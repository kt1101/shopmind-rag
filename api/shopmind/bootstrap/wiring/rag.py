"""A3 RAG + chat services (non-critical: search keeps working when RAG cannot start)."""
from __future__ import annotations

ORDER = 20
CRITICAL = False


def wire(container) -> None:
    config = container.config
    if not config.rag.enabled or container.get("rag_service") is not None or container.get("search_service") is None:
        return
    from shopmind.application.chat.service import ChatService
    from shopmind.application.rag.service import create_rag_service
    from shopmind.infrastructure.elasticsearch.knowledge_repository import ElasticsearchKnowledgeRepository

    client = container.get("es_client")
    rag_service = create_rag_service(container.search_service, client, container.get("embedder"), config.rag, review_index_alias=config.index_alias("reviews"), policy_index_alias=config.index_alias("policies"))
    container.provide("rag_service", rag_service)
    reviews = ElasticsearchKnowledgeRepository(client, config.index_alias("reviews"), source="review")
    repository = container.get("repository")
    container.provide("chat_service", ChatService(rag_service, config.rag.chat, reviews.alias_exists, lambda product_id: (repository.get_product(product_id) or {}).get("title")))
