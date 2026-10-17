"""Query-time caches: embeddings (text + image) and catalog facts used on every search."""
from __future__ import annotations

import numpy as np
from PIL import Image

from shopmind.core.config import AppConfig
from shopmind.infrastructure.elasticsearch.repository import ElasticsearchProductRepository
from shopmind.infrastructure.embedding.cache import CachingEmbedder
from shopmind.infrastructure.embedding.validation import embedding_identity
from shopmind.interfaces.http.schemas.search import TextSearchRequest


class CountingEmbedder:
    model_name = "fake"
    model_revision = "r1"
    dimension = 2
    text_preprocessing = {"p": 1}
    image_preprocessing = {"i": 1}

    def __init__(self):
        self.calls = {"texts": 0, "queries": 0, "images": 0}

    def embed_texts(self, texts):
        self.calls["texts"] += 1
        return np.array([[1.0, 0.0]] * len(texts), dtype=np.float32)

    def embed_queries(self, texts):
        self.calls["queries"] += 1
        return np.array([[0.0, 1.0]] * len(texts), dtype=np.float32)

    def embed_images(self, images):
        self.calls["images"] += 1
        return np.array([[0.6, 0.8]] * len(images), dtype=np.float32)


def test_caching_embedder_reuses_vectors_and_keeps_identity():
    inner = CountingEmbedder()
    cached = CachingEmbedder(inner)
    first = cached.embed_queries(["sofa"])
    first[0, 0] = 99.0  # callers cannot corrupt the cache
    assert cached.embed_queries(["sofa"]).tolist() == [[0.0, 1.0]]
    cached.embed_texts(["sofa"])
    assert inner.calls == {"texts": 1, "queries": 1, "images": 0}
    cached.embed_texts(["a", "b"])  # batches are not cached
    cached.embed_texts(["a", "b"])
    assert inner.calls["texts"] == 3
    assert embedding_identity(cached) == embedding_identity(inner) and cached.dimension == 2


def test_image_cache_is_keyed_by_pixels():
    inner = CountingEmbedder()
    cached = CachingEmbedder(inner)
    red, red_again, blue = Image.new("RGB", (4, 4), "red"), Image.new("RGB", (4, 4), "red"), Image.new("RGB", (4, 4), "blue")
    cached.embed_images([red])
    cached.embed_images([red_again])
    cached.embed_images([blue])
    assert inner.calls["images"] == 2
    assert cached.cache_stats()["image_hits"] == 1


class FakeIndices:
    def __init__(self):
        self.mapping_calls = 0

    def get_mapping(self, index):
        self.mapping_calls += 1
        return {"products_v2": {"mappings": {"properties": {"text_vector": {"dims": 2}}}}}


class FakeClient:
    def __init__(self):
        self.indices = FakeIndices()
        self.counts = 0

    def count(self, index, query):
        self.counts += 1
        return {"count": 1}

    def search(self, **kwargs):
        return {"hits": {"hits": []}}


def test_filter_resolution_and_mapping_are_cached():
    client = FakeClient()
    repository = ElasticsearchProductRepository(client, "products")
    for _ in range(3):
        repository.lexical_search("sofa", 10, {"brand": "Rivet", "category": ["SOFA", "CHAIR"]})
        repository.vector_search("text_vector", [0.6, 0.8], 10, 10, {"brand": "Rivet"})
    assert client.counts == 3  # Rivet, SOFA, CHAIR once each
    assert client.indices.mapping_calls == 1


def test_candidate_window_follows_config():
    payload = TextSearchRequest(query="sofa", top_k=10)
    assert payload.to_domain(None, 200).candidate_k == 200
    assert TextSearchRequest(query="sofa", top_k=10).to_domain().candidate_k == 100
    assert AppConfig.model_fields["retrieval"] is not None
