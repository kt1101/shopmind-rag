"""A1 product search: Elasticsearch repository, configured embedders, pipelines, SearchService."""
from __future__ import annotations

import logging

ORDER = 10
CRITICAL = True

logger = logging.getLogger("shopmind.bootstrap")


def _index_vector_fields(client, alias: str) -> set[str]:
    mappings = client.indices.get_mapping(index=alias)
    entry = next(iter(mappings.values()))
    return {name for name, spec in entry["mappings"].get("properties", {}).items() if spec.get("type") == "dense_vector"}


def wire(container) -> None:
    if container.get("search_service") is not None:
        return
    import shopmind.application.search.steps  # noqa: F401  (registers the search steps)
    from shopmind.application.catalog.service import CatalogService
    from shopmind.application.pipeline import PipelineFactory
    from shopmind.application.retrieval.language import configure_vocabulary
    from shopmind.application.search.service import SearchService
    from shopmind.infrastructure.elasticsearch.client import create_elasticsearch_client
    from shopmind.infrastructure.elasticsearch.repository import ElasticsearchProductRepository
    from shopmind.infrastructure.embedding.factory import build_embedders, field_embedder_ids

    config = container.config
    if config.vocabularies:
        configure_vocabulary(config.vocabularies)
    client = container.get("es_client") or container.provide("es_client", create_elasticsearch_client(config.elasticsearch))
    alias = config.index_alias("products") if "products" in config.indexes else config.elasticsearch.index_alias
    repository = ElasticsearchProductRepository(client, alias)
    field_embedders = field_embedder_ids(config, "products")
    embedders = build_embedders(config, list(dict.fromkeys(field_embedders.values())))
    present = _index_vector_fields(client, alias)
    bound = {}
    for field, embedder_id in field_embedders.items():
        if field not in present:
            logger.warning("products index has no %s; pipelines using it are unavailable", field)
            continue
        # Fails fast (→ /ready 503) when the index was built with a different model/preprocessing.
        repository.bind_embedding(embedders[embedder_id], field, "image" if field == "image_vector" else "text")
        bound[field] = embedder_id
    container.provide("repository", repository)
    container.provide("embedders", embedders)
    container.provide("field_embedders", bound)
    text_embedder = embedders[bound.get("text_vector") or next(iter(bound.values()))]
    container.provide("embedder", text_embedder)
    pipelines = container.get("pipelines") or container.provide("pipelines", PipelineFactory(config.pipelines, container))
    container.provide("search_service", SearchService(pipelines=pipelines, routes=dict(config.defaults)))
    container.provide("catalog_service", CatalogService(repository))
