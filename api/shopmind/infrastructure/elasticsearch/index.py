from __future__ import annotations

from typing import Any


def build_products_mapping(dimension: int, *, text_dimension: int | None = None, extra_vectors: dict[str, int] | None = None) -> dict[str, Any]:
    """Product index mapping. ``dimension`` sizes ``image_vector`` (and ``text_vector`` unless a
    dedicated text embedder gives ``text_dimension``); ``extra_vectors`` adds named dense fields
    such as ``siglip_text_vector``."""
    dims = {"text_vector": text_dimension or dimension, "image_vector": dimension, **(extra_vectors or {})}
    if any(value <= 0 for value in dims.values()):
        raise ValueError("dimension must be positive")
    keyword_subfield = {"keyword": {"type": "keyword", "ignore_above": 256}}
    properties: dict[str, Any] = {"product_id": {"type": "keyword"}, "title": {"type": "text", "fields": keyword_subfield}, "description": {"type": "text"}, "brand": {"type": "text", "fields": keyword_subfield}, "category": {"type": "text", "fields": keyword_subfield}, "attributes": {"type": "object", "enabled": False}, "attributes_text": {"type": "text"}, "search_text": {"type": "text"}, "image_url": {"type": "keyword", "index": False}, "embedding_model": {"type": "keyword"}, "embedding_version": {"type": "keyword"}, "embedding_identities": {"type": "object", "enabled": False}, "color": {"type": "keyword"}, "metadata": {"type": "object", "dynamic": True}}
    for field, size in dims.items():
        properties[field] = {"type": "dense_vector", "dims": size, "index": True, "similarity": "cosine"}
    return {"mappings": {"dynamic": "strict", "properties": properties}}


def create_versioned_index(client: Any, index_name: str, dimension: int, *, recreate: bool = False, embedding_metadata: dict[str, Any] | None = None, text_dimension: int | None = None, extra_vectors: dict[str, int] | None = None) -> None:
    exists = bool(client.indices.exists(index=index_name))
    if exists and not recreate:
        raise FileExistsError(f"Elasticsearch index already exists: {index_name}")
    if exists:
        indices = client.indices.get(index=index_name)
        if any(name != index_name or details.get("aliases") for name, details in indices.items()):
            raise ValueError("cannot recreate an index with aliases; use a new versioned index")
        client.indices.delete(index=index_name)
    mapping = build_products_mapping(dimension, text_dimension=text_dimension, extra_vectors=extra_vectors)
    if embedding_metadata is not None:
        mapping["mappings"]["_meta"] = embedding_metadata
    client.indices.create(index=index_name, **mapping)


def _mapping_dimension(client: Any, index_name: str, field: str) -> int:
    response = client.indices.get_mapping(index=index_name)
    mapping = response[index_name] if index_name in response else next(iter(response.values()))
    return int(mapping["mappings"]["properties"][field]["dims"])


def validate_product_index(client: Any, index_name: str, *, expected_count: int, dimension: int, smoke_query: str, smoke_vector: list[float], vector_dims: dict[str, int] | None = None) -> None:
    """Doc count, per-field vector dims, BM25 smoke and kNN smoke (``smoke_vector`` is a ``text_vector``)."""
    from shopmind.infrastructure.elasticsearch.repository import ElasticsearchProductRepository
    count = int(client.count(index=index_name)["count"])
    if count != expected_count:
        raise ValueError(f"index document count {count} does not match expected {expected_count}")
    expected_dims = vector_dims or {"text_vector": dimension, "image_vector": dimension}
    for field, size in expected_dims.items():
        actual = _mapping_dimension(client, index_name, field)
        if actual != size:
            raise ValueError(f"{field} mapping dimension {actual} does not match expected {size}")
    if expected_count == 0:
        return
    if len(smoke_vector) != expected_dims["text_vector"]:
        raise ValueError("smoke vector dimension does not match index dimension")
    repository = ElasticsearchProductRepository(client, index_name)
    lexical = repository.lexical_search(smoke_query, size=1, filters={})
    if not lexical:
        raise ValueError("BM25 smoke query returned no results")
    dense = repository.vector_search("text_vector", smoke_vector, size=1, num_candidates=max(1, min(expected_count, 10)), filters={})
    if not dense:
        raise ValueError("kNN smoke query returned no results")


def switch_alias(client: Any, *, alias: str, target: str) -> None:
    if not bool(client.indices.exists(index=target)):
        raise ValueError(f"target index does not exist: {target}")
    actions: list[dict[str, Any]] = []
    if bool(client.indices.exists_alias(name=alias)):
        existing = client.indices.get_alias(name=alias)
        for index_name in sorted(existing):
            if index_name != target:
                actions.append({"remove": {"index": index_name, "alias": alias}})
    actions.append({"add": {"index": target, "alias": alias}})
    client.indices.update_aliases(actions=actions)
