"""A1 product search: Elasticsearch repository, SigLIP2 embedder, retrievers, SearchService."""
from __future__ import annotations

ORDER = 10
CRITICAL = True


def wire(container) -> None:
    if container.get("search_service") is not None:
        return
    from shopmind.application.catalog.service import CatalogService
    from shopmind.application.retrieval.bm25 import BM25Retriever
    from shopmind.application.retrieval.dense import CrossModalRetriever, ImageDenseRetriever, TextDenseRetriever
    from shopmind.application.retrieval.hybrid import HybridRetriever
    from shopmind.application.retrieval.reranker import NoOpReranker
    from shopmind.application.search.service import SearchService
    from shopmind.infrastructure.elasticsearch.client import create_elasticsearch_client
    from shopmind.infrastructure.elasticsearch.repository import ElasticsearchProductRepository
    from shopmind.infrastructure.embedding.siglip2 import SigLIP2EmbeddingProvider

    config = container.config
    client = container.get("es_client") or container.provide("es_client", create_elasticsearch_client(config.elasticsearch))
    repository = ElasticsearchProductRepository(client, config.index_alias("products") if "products" in config.indexes else config.elasticsearch.index_alias)
    embedder = SigLIP2EmbeddingProvider(model_name=config.embedding.model_name, model_revision=config.embedding.model_revision, hf_token=config.embedding.hf_token)
    repository.bind_embedding(embedder)
    repository.bind_embedding(embedder, "image_vector", "image")
    bm25 = BM25Retriever(repository)
    dense = TextDenseRetriever(repository, embedder)
    cross_modal = CrossModalRetriever(repository, embedder)
    hybrid = HybridRetriever(bm25, dense, NoOpReranker(), rrf_k=config.fusion.rrf_k, lexical_preserving=config.fusion.lexical_preserving)
    image = ImageDenseRetriever(repository, embedder)
    container.provide("repository", repository)
    container.provide("embedder", embedder)
    container.provide("search_service", SearchService(bm25=bm25, dense=dense, hybrid=hybrid, cross_modal=cross_modal, image=image))
    container.provide("catalog_service", CatalogService(repository))
