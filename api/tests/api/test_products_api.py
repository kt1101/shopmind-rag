from __future__ import annotations

import elasticsearch
import pytest
from fastapi.testclient import TestClient

from shopmind.app.api.errors import InvalidPagination, ProductNotFound, SearchInfrastructureError
from shopmind.app.catalog.service import CatalogService
from shopmind.app.infrastructure.elasticsearch.repository import ProductIndexMissing
from shopmind.app.main import create_app


class FakeCatalogService:
    def __init__(self):
        self.calls = []
        self.error = None
        self.detail = {"product_id": "P1", "title": "T", "brand": None, "category": "SHOES", "category_label": "Shoes", "description": "", "attributes": [{"name": "Color", "value": "Black"}], "bullet_points": ["Soft"], "category_path": ["Home"], "image_url": None, "search_text": "secret", "text_vector": [0.1, 0.2]}

    def list_products(self, *, categories, brands, limit, offset):
        self.calls.append({"categories": categories, "brands": brands, "limit": limit, "offset": offset})
        if self.error:
            raise self.error
        return {"items": [{"product_id": "P1", "title": "T", "image_url": None, "brand": "Klepe", "category": "SHOES", "search_text": "secret"}], "total": 1, "limit": limit, "offset": offset, "facets": {"category": [{"value": "SHOES", "label": "Shoes", "count": 1}]}}

    def get_product(self, product_id):
        if self.error:
            raise self.error
        return self.detail


@pytest.fixture
def fake():
    return FakeCatalogService()


@pytest.fixture
def client(fake):
    with TestClient(create_app(catalog_service=fake, auto_wire=False)) as test_client:
        yield test_client


def test_list_products_response_shape(client, fake):
    r = client.get("/api/v1/products?category=SHOES&category=BOOT&brand=Klepe&limit=12&offset=24")
    assert r.status_code == 200 and fake.calls[-1] == {"categories": ["SHOES", "BOOT"], "brands": ["Klepe"], "limit": 12, "offset": 24}
    assert set(r.json()) == {"items", "total", "limit", "offset", "facets"}
    assert set(r.json()["items"][0]) == {"product_id", "title", "image_url", "brand", "category"}
    assert r.json()["facets"] == {"category": [{"value": "SHOES", "label": "Shoes", "count": 1}]}


def test_list_products_defaults(client, fake):
    assert client.get("/api/v1/products").status_code == 200
    assert fake.calls[-1] == {"categories": [], "brands": [], "limit": 24, "offset": 0}


def test_list_products_passes_blank_category_through_to_service(client, fake):
    assert client.get("/api/v1/products?category=").status_code == 200
    assert fake.calls[-1]["categories"] == [""]


@pytest.mark.parametrize("query", ["limit=61", "limit=0", "offset=-1"])
def test_list_products_validation(client, query):
    r = client.get(f"/api/v1/products?{query}")
    assert r.status_code == 422 and r.json()["error"]["code"] == "validation_error"


def test_list_products_invalid_pagination(client, fake):
    fake.error = InvalidPagination("window")
    r = client.get("/api/v1/products?offset=9990&limit=60")
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_pagination"


def test_product_detail_has_only_whitelisted_fields(client):
    r = client.get("/api/v1/products/P1")
    assert r.status_code == 200
    assert set(r.json()) == {"product_id", "title", "brand", "category", "category_label", "description", "attributes", "bullet_points", "category_path", "image_url"}
    assert "search_text" not in r.text and "text_vector" not in r.text


def test_product_detail_attributes_are_name_value_pairs(client):
    assert client.get("/api/v1/products/P1").json()["attributes"] == [{"name": "Color", "value": "Black"}]


def test_product_detail_404(client, fake):
    fake.error = ProductNotFound("nope")
    r = client.get("/api/v1/products/NOPE")
    assert r.status_code == 404 and r.json()["error"]["code"] == "product_not_found"


def test_product_id_too_long_is_422(client):
    assert client.get("/api/v1/products/" + "x" * 129).status_code == 422


def test_products_503_without_service():
    with TestClient(create_app(auto_wire=False)) as c:
        for path in ("/api/v1/products", "/api/v1/products/P1"):
            r = c.get(path)
            assert r.status_code == 503 and r.json()["error"]["code"] == "search_infrastructure_unavailable"


def test_products_503_on_infrastructure_error(client, fake):
    fake.error = SearchInfrastructureError("down")
    for path in ("/api/v1/products", "/api/v1/products/P1"):
        r = client.get(path)
        assert r.status_code == 503 and r.json()["error"]["code"] == "search_infrastructure_unavailable"


@pytest.mark.parametrize("error_factory", [lambda: elasticsearch.ConnectionError("down"), lambda: ProductIndexMissing("products")])
def test_real_catalog_service_maps_repository_failures_to_503(error_factory):
    class Repo:
        def list_products(self, filters, offset, size):
            raise error_factory()

        def get_product(self, product_id):
            raise error_factory()

    with TestClient(create_app(catalog_service=CatalogService(Repo()), auto_wire=False)) as c:
        for path in ("/api/v1/products", "/api/v1/products/P1"):
            r = c.get(path)
            assert r.status_code == 503 and r.json()["error"]["code"] == "search_infrastructure_unavailable"
