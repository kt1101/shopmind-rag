from __future__ import annotations

from pydantic import BaseModel


class ProductSummary(BaseModel):
    product_id: str
    title: str
    image_url: str | None = None
    brand: str | None = None
    category: str | None = None


class CategoryFacet(BaseModel):
    value: str
    label: str
    count: int


class ProductFacets(BaseModel):
    category: list[CategoryFacet]


class ProductListResponse(BaseModel):
    items: list[ProductSummary]
    total: int
    limit: int
    offset: int
    facets: ProductFacets


class ProductAttribute(BaseModel):
    name: str
    value: str


class ProductDetailResponse(BaseModel):
    product_id: str
    title: str
    brand: str | None = None
    category: str | None = None
    category_label: str | None = None
    description: str = ""
    attributes: list[ProductAttribute]
    bullet_points: list[str]
    category_path: list[str]
    image_url: str | None = None
