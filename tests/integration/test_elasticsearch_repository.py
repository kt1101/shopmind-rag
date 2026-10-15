from __future__ import annotations

import os
import uuid
import pytest

pytestmark=pytest.mark.integration


def _client_or_skip():
    try: from elasticsearch import Elasticsearch
    except ImportError: pytest.skip("elasticsearch Python package is not installed")
    url=os.getenv("ELASTICSEARCH_URL","http://localhost:9200"); client=Elasticsearch(url)
    try:
        if not client.ping(): pytest.skip(f"Elasticsearch is not reachable at {url}")
    except Exception as exc: pytest.skip(f"Elasticsearch is not reachable: {exc}")
    return client


def test_repository_bm25_vector_filter_and_alias_lifecycle():
    from shopmind.app.infrastructure.elasticsearch.index import create_versioned_index,switch_alias,validate_product_index
    from shopmind.app.infrastructure.elasticsearch.repository import ElasticsearchProductRepository
    client=_client_or_skip(); index_name=f"test_products_{uuid.uuid4().hex}"; alias=f"test_products_alias_{uuid.uuid4().hex}"
    documents=[{"product_id":"P1","title":"Black Running Shoe","description":"lightweight runner","brand":"Acme","category":"Shoes","attributes":{"color":"black"},"attributes_text":"color: black","search_text":"Black Running Shoe","image_url":None,"text_vector":[1.0,0.0,0.0,0.0],"image_vector":[1.0,0.0,0.0,0.0],"embedding_model":"fake","embedding_version":"test","metadata":{}},{"product_id":"P2","title":"Oak Chair","description":"wood dining chair","brand":"WoodCo","category":"Furniture","attributes":{"material":"oak"},"attributes_text":"material: oak","search_text":"Oak Chair","image_url":None,"text_vector":[0.0,1.0,0.0,0.0],"image_vector":[0.0,1.0,0.0,0.0],"embedding_model":"fake","embedding_version":"test","metadata":{}},{"product_id":"P3","title":"Trail Boot","description":"outdoor boot","brand":"Acme","category":"Shoes","attributes":{},"attributes_text":"","search_text":"Trail Boot","image_url":None,"text_vector":[0.9,0.1,0.0,0.0],"image_vector":[0.9,0.1,0.0,0.0],"embedding_model":"fake","embedding_version":"test","metadata":{}}]
    try:
        create_versioned_index(client,index_name,4); repo=ElasticsearchProductRepository(client,index_name); success,errors=repo.bulk_index(index_name,documents); assert success==3 and errors==[]; client.indices.refresh(index=index_name)
        lexical=repo.lexical_search("Black Running Shoe",3,{}); assert lexical[0].product_id=="P1"
        assert repo.lexical_search("p2",3,{})[0].product_id == "P2"
        assert {h.product_id for h in repo.lexical_search(None,3,{"brand":["acme","WoodCo"]})} == {"P1","P2","P3"}
        assert repo.lexical_search("chair",3,{"brand":"Acme"}) == []
        assert repo.lexical_search(None,3,{"brand":"Acme","category":"Furniture"}) == []
        assert {h.product_id for h in repo.vector_search("text_vector",[1,0,0,0],3,3,{"brand":["acm","WoodCo"]})} == {"P1","P2","P3"}
        assert repo.filter_options("brand", "*", 5) == []
        assert repo.filter_options("product_id", "p", 5)[0]["value"] == "P1"
        filtered_only=repo.lexical_search(None,3,{"brand":"acme"}); assert {hit.product_id for hit in filtered_only}=={"P1","P3"}
        partial=repo.lexical_search("shoe",3,{"category":"hoe"}); assert partial[0].product_id=="P1"
        vector=repo.vector_search("text_vector",[1,0,0,0],2,3,{}); assert vector[0].product_id=="P1"
        filtered=repo.vector_search("text_vector",[1,0,0,0],3,3,{"category":"Furniture"}); assert {hit.product_id for hit in filtered}=={"P2"}
        validate_product_index(client,index_name,expected_count=3,dimension=4,smoke_query="Black Running Shoe",smoke_vector=[1,0,0,0]); switch_alias(client,alias=alias,target=index_name); aliases=client.indices.get_alias(name=alias); assert index_name in aliases
    finally:
        try: client.indices.delete(index=index_name,ignore_unavailable=True)
        except Exception: pass


def test_embedding_contract_pins_alias_and_rejects_wrong_identity_and_vectors():
    from types import SimpleNamespace
    from shopmind.app.embedding.validation import index_embedding_metadata
    from shopmind.app.infrastructure.elasticsearch.index import create_versioned_index, switch_alias
    from shopmind.app.infrastructure.elasticsearch.repository import ElasticsearchProductRepository
    client=_client_or_skip();a=f"test_contract_{uuid.uuid4().hex}";b=f"test_contract_{uuid.uuid4().hex}";alias=f"test_contract_alias_{uuid.uuid4().hex}"
    embedder=SimpleNamespace(model_name="fake",model_revision="rev",dimension=4,text_preprocessing={"padding":"fixed"})
    try:
        create_versioned_index(client,a,4,embedding_metadata=index_embedding_metadata(embedder))
        create_versioned_index(client,b,4)
        switch_alias(client,alias=alias,target=a)
        repo=ElasticsearchProductRepository(client,alias);repo.bind_embedding(embedder)
        switch_alias(client,alias=alias,target=b)
        assert repo.index_alias==a
        repo.bind_embedding(embedder)
        with pytest.raises(ValueError):ElasticsearchProductRepository(client,alias).bind_embedding(embedder)
        for vector in ([0,0,0,0],[float("nan"),0,0,1],[1,0,0]):
            with pytest.raises(ValueError):repo.vector_search("text_vector",vector,1,1,{})
        with pytest.raises(ValueError):repo.bulk_index(a,[{"product_id":"P", "text_vector":[1,0,0,0], "embedding_model":"fake", "embedding_version":"wrong"}])
        assert client.count(index=a)["count"]==0
    finally:
        client.indices.delete(index=f"{a},{b}",ignore_unavailable=True)


def _catalog_documents():
    def doc(pid, title, brand, category, extra=None):
        return {"product_id": pid, "title": title, "description": title, "brand": brand, "category": category, "attributes": {}, "attributes_text": "", "search_text": title, "image_url": None, "text_vector": [1.0, 0.0, 0.0, 0.0], "image_vector": [1.0, 0.0, 0.0, 0.0], "embedding_model": "fake", "embedding_version": "test", "metadata": extra or {}}
    return [doc("P1", "Black Running Shoe", "Acme", "SHOES", {"bullet_points": ["light"]}), doc("P2", "Oak Chair", "WoodCo", "CHAIR"), doc("P3", "Trail Boot", "Acme", "SHOES"), doc("P4", "Sofa", "WoodCo", "SOFA")]


def test_list_products_and_get_product_against_real_index():
    from shopmind.app.infrastructure.elasticsearch.index import create_versioned_index
    from shopmind.app.infrastructure.elasticsearch.repository import ElasticsearchProductRepository
    client = _client_or_skip(); index_name = f"test_products_{uuid.uuid4().hex}"
    documents = _catalog_documents()
    try:
        create_versioned_index(client, index_name, 4); repo = ElasticsearchProductRepository(client, index_name)
        success, errors = repo.bulk_index(index_name, documents); assert success == len(documents) and errors == []; client.indices.refresh(index=index_name)
        everything = repo.list_products({}, 0, 2)
        assert everything.total == len(documents) and [item["product_id"] for item in everything.items] == ["P1", "P2"]
        assert all(not ({"text_vector", "image_vector", "search_text"} & set(item)) for item in everything.items)
        assert everything.category_facets == (("SHOES", 2), ("CHAIR", 1), ("SOFA", 1))
        assert [item["product_id"] for item in repo.list_products({}, 2, 2).items] == ["P3", "P4"]
        filtered = repo.list_products({"category": ["shoes"]}, 0, 24)
        assert filtered.total == 2 and {item["product_id"] for item in filtered.items} == {"P1", "P3"}
        assert sum(count for _, count in filtered.category_facets) == len(documents)
        branded = repo.list_products({"brand": ["acme"], "category": ["SHOES"]}, 0, 24)
        assert branded.total == 2 and sum(count for _, count in branded.category_facets) == 2
        assert repo.list_products({"category": ["hoe"]}, 0, 24).total == 2
        product = repo.get_product("P1")
        assert product is not None and product["title"] == "Black Running Shoe" and product["metadata"]["bullet_points"] == ["light"]
        assert not ({"text_vector", "image_vector", "search_text"} & set(product))
        assert repo.get_product("NOPE") is None
    finally:
        try: client.indices.delete(index=index_name, ignore_unavailable=True)
        except Exception: pass


def test_get_product_raises_product_index_missing_for_unknown_index():
    from shopmind.app.infrastructure.elasticsearch.repository import ElasticsearchProductRepository, ProductIndexMissing
    client = _client_or_skip()
    repo = ElasticsearchProductRepository(client, f"test_missing_{uuid.uuid4().hex}")
    with pytest.raises(ProductIndexMissing):
        repo.get_product("P1")
