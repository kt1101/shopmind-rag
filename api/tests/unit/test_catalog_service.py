from __future__ import annotations

import elasticsearch
import pytest

from shopmind.app.api.errors import InvalidFilter, InvalidPagination, ProductNotFound, SearchInfrastructureError
from shopmind.app.catalog.service import CatalogService, humanize_category
from shopmind.app.domain.catalog import ProductPage
from shopmind.app.infrastructure.elasticsearch.repository import ProductIndexMissing


class FakeRepo:
    def __init__(self, source=None, page=None, error=None):
        self.source = source
        self.page = page or ProductPage(items=(), total=0, category_facets=())
        self.error = error
        self.list_calls = []
        self.get_calls = []

    def list_products(self, filters, offset, size):
        self.list_calls.append((filters, offset, size))
        if self.error:
            raise self.error
        return self.page

    def get_product(self, product_id):
        self.get_calls.append(product_id)
        if self.error:
            raise self.error
        return self.source


def _list(service, **overrides):
    kwargs = {"categories": [], "brands": [], "page": 1, "page_size": 24}
    kwargs.update(overrides)
    return service.list_products(**kwargs)


def test_humanize_category():
    assert humanize_category("HOME_BED_AND_BATH") == "Home Bed And Bath"
    assert humanize_category("SHOES") == "Shoes"


def test_list_maps_summaries_and_facets():
    page = ProductPage(
        items=({"product_id": "P1", "title": "T", "brand": "B", "category": "SHOES", "image_url": "/media/p1.jpg", "search_text": "x", "text_vector": [0.1]}, {"product_id": "P2", "title": "U"}),
        total=2,
        category_facets=(("SHOES", 5), ("HOME_BED_AND_BATH", 2)),
    )
    result = _list(CatalogService(FakeRepo(page=page)), page=3, page_size=2)
    assert result["total"] == 2 and result["page"] == 3 and result["page_size"] == 2
    assert result["items"][0] == {"product_id": "P1", "title": "T", "image_url": "/media/p1.jpg", "brand": "B", "category": "SHOES"}
    assert result["items"][1] == {"product_id": "P2", "title": "U", "image_url": None, "brand": None, "category": None}
    assert result["facets"] == {"category": [{"value": "SHOES", "label": "Shoes", "count": 5}, {"value": "HOME_BED_AND_BATH", "label": "Home Bed And Bath", "count": 2}]}


def test_detail_maps_metadata_and_tolerates_missing_fields():
    d = CatalogService(FakeRepo(source={"product_id": "P1", "title": "T", "brand": None, "category": "HOME_BED_AND_BATH",
        "description": "", "attributes": {"color": "Black", "size": 9}, "metadata": {"bullet_points": ["Soft", 3], "node_paths": ["/Home/Bedding//Sheets"]}})).get_product("P1")
    assert d["category_label"] == "Home Bed And Bath" and d["brand"] is None and d["image_url"] is None
    assert d["attributes"] == {"color": "Black", "size": "9"} and d["bullet_points"] == ["Soft"] and d["category_path"] == ["Home", "Bedding", "Sheets"]
    assert set(d) == {"product_id", "title", "brand", "category", "category_label", "description", "attributes", "bullet_points", "category_path", "image_url"}


def test_detail_without_metadata_has_empty_lists():
    d = CatalogService(FakeRepo(source={"product_id": "P1", "title": "T"})).get_product("P1")
    assert d["bullet_points"] == [] and d["category_path"] == [] and d["attributes"] == {} and d["description"] == ""
    assert d["category"] is None and d["category_label"] is None and d["image_url"] is None


def test_blank_filters_are_dropped():
    repo = FakeRepo()
    _list(CatalogService(repo), categories=["", " "], brands=["Klepe"])
    assert repo.list_calls[-1][0] == {"brand": ["Klepe"]}
    _list(CatalogService(repo), categories=[" SHOES "], brands=[" "])
    assert repo.list_calls[-1][0] == {"category": ["SHOES"]}
    _list(CatalogService(repo))
    assert repo.list_calls[-1][0] == {}


def test_paging_window_over_10000_raises_invalid_pagination():
    repo = FakeRepo()
    service = CatalogService(repo)
    with pytest.raises(InvalidPagination):
        _list(service, page=418, page_size=24)
    assert repo.list_calls == []
    _list(service, page=416, page_size=24)
    assert repo.list_calls[-1][1:] == (415 * 24, 24)


def test_errors_are_mapped():
    for error in (elasticsearch.ConnectionError("down"), ProductIndexMissing("products")):
        with pytest.raises(SearchInfrastructureError):
            _list(CatalogService(FakeRepo(error=error)))
        with pytest.raises(SearchInfrastructureError):
            CatalogService(FakeRepo(error=error)).get_product("P1")
    with pytest.raises(ProductNotFound):
        CatalogService(FakeRepo(source=None)).get_product("missing")
    with pytest.raises(InvalidFilter):
        _list(CatalogService(FakeRepo(error=ValueError("bad"))))
