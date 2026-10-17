from __future__ import annotations

import json

import pytest

from shopmind.domain.catalog import ProductPage
from shopmind.infrastructure.elasticsearch.repository import ElasticsearchProductRepository, ProductIndexMissing

_EXCLUDES = {"text_vector", "image_vector", "siglip_text_vector", "embedding_identities", "search_text"}


class _GetClient:
    def __init__(self, response):
        self.response = response
        self.options_kwargs = None
        self.get_kwargs = None

    def options(self, **kwargs):
        self.options_kwargs = kwargs
        return self

    def get(self, **kwargs):
        self.get_kwargs = kwargs
        return self.response


class FakeES:
    def __init__(self, count_hits=1, search_response=None, get_response=None):
        self.count_hits = count_hits
        self.search_response = search_response or {"hits": {"total": {"value": 0, "relation": "eq"}, "hits": []}, "aggregations": {"categories": {"buckets": []}}}
        self.get_client = _GetClient(get_response)
        self.search_kwargs = None
        self.count_calls = []

    def count(self, **kwargs):
        self.count_calls.append(kwargs)
        return {"count": self.count_hits}

    def search(self, **kwargs):
        self.search_kwargs = kwargs
        return self.search_response

    def options(self, **kwargs):
        return self.get_client.options(**kwargs)


def _repo(count_hits=1, search_response=None, get_response=None):
    es = FakeES(count_hits, search_response, get_response)
    return ElasticsearchProductRepository(es, "products"), es


def test_list_products_post_filters_category_so_facets_ignore_it():
    repo, es = _repo(count_hits=1)
    repo.list_products({"category": ["SHOES"], "brand": ["Klepe"]}, offset=24, size=24)
    kw = es.search_kwargs
    assert kw["index"] == "products"
    assert kw["from_"] == 24 and kw["size"] == 24 and kw["track_total_hits"] is True
    assert kw["sort"] == [{"product_id": "asc"}]
    assert "category.keyword" in json.dumps(kw["post_filter"]) and "category" not in json.dumps(kw["query"])
    assert "brand.keyword" in json.dumps(kw["query"])
    assert kw["aggs"]["categories"]["terms"] == {"field": "category.keyword", "size": 300, "order": [{"_count": "desc"}, {"_key": "asc"}]}
    assert set(kw["source_excludes"]) == _EXCLUDES


def test_list_products_without_category_has_no_post_filter():
    repo, es = _repo()
    repo.list_products({"brand": ["Klepe"]}, offset=0, size=24)
    assert "post_filter" not in es.search_kwargs
    assert "brand.keyword" in json.dumps(es.search_kwargs["query"])
    repo.list_products({}, offset=0, size=24)
    assert "post_filter" not in es.search_kwargs
    assert es.search_kwargs["query"] == {"bool": {"filter": []}}


def test_list_products_unknown_category_falls_back_to_partial_match():
    repo, es = _repo(count_hits=0)
    repo.list_products({"category": ["shoe"]}, 0, 24)
    assert "wildcard" in json.dumps(es.search_kwargs["post_filter"])


def test_list_products_maps_hits_total_and_buckets():
    response = {
        "hits": {"total": {"value": 150, "relation": "eq"}, "hits": [{"_id": "P1", "_source": {"product_id": "P1", "title": "Shoe"}}, {"_id": "P2", "_source": {"product_id": "P2", "title": "Boot"}}]},
        "aggregations": {"categories": {"buckets": [{"key": "SHOES", "doc_count": 150}]}},
    }
    repo, _ = _repo(search_response=response)
    page = repo.list_products({}, 0, 24)
    assert isinstance(page, ProductPage)
    assert page.total == 150
    assert page.category_facets == (("SHOES", 150),)
    assert page.items[0]["product_id"] == "P1" and page.items[1]["title"] == "Boot"
    assert isinstance(page.items, tuple)


def test_get_product_found_missing_doc_and_missing_index():
    repo, es = _repo(get_response={"found": True, "_id": "P1", "_source": {"product_id": "P1", "title": "Shoe"}})
    assert repo.get_product("P1") == {"product_id": "P1", "title": "Shoe"}
    assert es.get_client.options_kwargs == {"ignore_status": 404}
    assert es.get_client.get_kwargs["index"] == "products" and es.get_client.get_kwargs["id"] == "P1"
    assert set(es.get_client.get_kwargs["source_excludes"]) == _EXCLUDES

    repo, _ = _repo(get_response={"found": False, "_id": "NOPE"})
    assert repo.get_product("NOPE") is None

    repo, _ = _repo(get_response={"error": {"type": "index_not_found_exception"}, "status": 404})
    with pytest.raises(ProductIndexMissing):
        repo.get_product("P1")
