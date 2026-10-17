from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from shopmind.interfaces.http.schemas.search import ProductSearchResult


class Price(BaseModel):
    amount: float
    currency: str = "USD"
    synthetic: bool = True


class Stock(BaseModel):
    in_stock: bool
    quantity: int
    synthetic: bool = True


class ProductSummary(BaseModel):
    product_id: str
    title: str
    image_url: str | None = None
    brand: str | None = None
    category: str | None = None
    price: Price | None = None


class CategoryFacet(BaseModel):
    value: str
    label: str
    count: int


class ProductFacets(BaseModel):
    category: list[CategoryFacet]


class ProductListResponse(BaseModel):
    items: list[ProductSummary]
    total: int
    page: int
    page_size: int
    limit: int | None = None
    offset: int | None = None
    facets: ProductFacets


class ProductDetailResponse(BaseModel):
    product_id: str
    title: str
    brand: str | None = None
    category: str | None = None
    category_label: str | None = None
    description: str = ""
    attributes: dict[str, str]
    bullet_points: list[str]
    category_path: list[str]
    image_url: str | None = None
    images: list[str] = Field(default_factory=list)
    price: Price | None = None
    stock: Stock | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class SimilarProductsResponse(BaseModel):
    product_id: str
    items: list[ProductSearchResult]
