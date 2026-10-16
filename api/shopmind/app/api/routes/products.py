from __future__ import annotations

from fastapi import APIRouter, Depends, Path, Query, Request

from shopmind.app.api.errors import SearchInfrastructureError
from shopmind.app.api.schemas.products import ProductDetailResponse, ProductListResponse
from shopmind.app.catalog.service import CatalogService

router = APIRouter(prefix="/api/v1/products", tags=["products"])


def get_catalog_service(request: Request) -> CatalogService:
    service = getattr(request.app.state, "catalog_service", None)
    if service is None:
        raise SearchInfrastructureError("catalog service is not ready")
    return service


@router.get("", response_model=ProductListResponse)
def list_products(page: int = Query(1, ge=1), page_size: int = Query(24, ge=1, le=60), category: list[str] | None = Query(None), brand: list[str] | None = Query(None), service: CatalogService = Depends(get_catalog_service)) -> ProductListResponse:
    result = service.list_products(categories=category or [], brands=brand or [], page=page, page_size=page_size)
    return ProductListResponse(**result)


@router.get("/{product_id}", response_model=ProductDetailResponse)
def get_product(product_id: str = Path(max_length=128), service: CatalogService = Depends(get_catalog_service)) -> ProductDetailResponse:
    return ProductDetailResponse(**service.get_product(product_id))
