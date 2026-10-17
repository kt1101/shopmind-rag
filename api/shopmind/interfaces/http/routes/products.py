from __future__ import annotations

from fastapi import APIRouter, Depends, Path, Query, Request

from shopmind.interfaces.http.deps import component, traced
from shopmind.interfaces.http.errors import InvalidPagination, ProductNotFound, SearchInfrastructureError
from shopmind.interfaces.http.schemas.products import ProductDetailResponse, ProductListResponse, SimilarProductsResponse
from shopmind.interfaces.http.schemas.search import ProductSearchResult
from shopmind.application.catalog.service import CatalogService

router = APIRouter(prefix="/api/v1/products", tags=["products"])


def get_catalog_service(request: Request) -> CatalogService:
    service = component(request, "catalog_service")
    if service is None:
        raise SearchInfrastructureError("catalog service is not ready")
    return service


@router.get("", response_model=ProductListResponse, response_model_exclude_none=True)
def list_products(page: int = Query(1, ge=1), page_size: int = Query(24, ge=1, le=60), limit: int | None = Query(None, ge=1, le=60), offset: int | None = Query(None, ge=0), category: list[str] | None = Query(None), brand: list[str] | None = Query(None), service: CatalogService = Depends(get_catalog_service)) -> ProductListResponse:
    # Contract paging is limit/offset; page/page_size stays for the existing storefront.
    if limit is not None or offset is not None:
        page_size = limit or page_size
        start = offset or 0
        if start % page_size:
            raise InvalidPagination("offset must be a multiple of limit")
        page = start // page_size + 1
    result = service.list_products(categories=category or [], brands=brand or [], page=page, page_size=page_size)
    return ProductListResponse(**result, limit=page_size, offset=(page - 1) * page_size)


@router.get("/{product_id}", response_model=ProductDetailResponse, response_model_exclude_none=True)
def get_product(product_id: str = Path(max_length=128), service: CatalogService = Depends(get_catalog_service)) -> ProductDetailResponse:
    return ProductDetailResponse(**service.get_product(product_id))


@router.get("/{product_id}/similar", response_model=SimilarProductsResponse)
def similar_products(request: Request, product_id: str = Path(max_length=128), limit: int = Query(8, ge=1, le=24)) -> SimilarProductsResponse:
    """Visually similar products: image kNN around the product's own SigLIP2 image vector."""
    repository = component(request, "repository")
    search = component(request, "search_service")
    if repository is None or search is None or not hasattr(repository, "product_vector"):
        raise SearchInfrastructureError("similar products are not available")
    vector = repository.product_vector(product_id, "image_vector")
    if vector is None:
        if repository.get_product(product_id) is None:
            raise ProductNotFound(f"product not found: {product_id}")
        return SimilarProductsResponse(product_id=product_id, items=[])
    with traced(request, "search.similar", kind="image_search", input={"product_id": product_id, "limit": limit}):
        results = search.similar(product_id, vector, limit=limit)
    return SimilarProductsResponse(product_id=product_id, items=[ProductSearchResult.from_domain(result) for result in results])
