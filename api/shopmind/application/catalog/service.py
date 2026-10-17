from __future__ import annotations

from typing import Any

import elasticsearch

from shopmind.interfaces.http.errors import InvalidFilter, InvalidPagination, ProductNotFound, SearchInfrastructureError
from shopmind.infrastructure.elasticsearch.repository import ProductIndexMissing

MAX_RESULT_WINDOW = 10000


def humanize_category(value: str) -> str:
    return " ".join(word.capitalize() for word in value.split("_"))


def _optional_str(value: Any) -> str | None:
    return value if isinstance(value, str) and value else None


def _clean(values: list[str]) -> list[str]:
    return [stripped for value in values if (stripped := value.strip())]


class CatalogService:
    """Catalog listing / detail. ``commerce`` (optional) adds synthetic price and stock, always
    flagged ``synthetic: true`` because ABO has no commerce data."""

    def __init__(self, repository: Any, commerce: Any | None = None) -> None:
        self.repository = repository
        self.commerce = commerce

    def _overlay(self, product_ids: list[str]) -> dict[str, dict[str, Any]]:
        if self.commerce is None or not product_ids:
            return {}
        try:
            return dict(self.commerce.get_many(product_ids) or {})
        except Exception:
            return {}

    def list_products(self, *, categories: list[str], brands: list[str], page: int, page_size: int) -> dict[str, Any]:
        if page * page_size > MAX_RESULT_WINDOW:
            raise InvalidPagination(f"page * page_size must be <= {MAX_RESULT_WINDOW}")
        filters = {key: values for key, values in (("category", _clean(categories)), ("brand", _clean(brands))) if values}
        try:
            result = self.repository.list_products(filters, (page - 1) * page_size, page_size)
        except ValueError as exc:
            raise InvalidFilter(str(exc)) from exc
        except (ProductIndexMissing, elasticsearch.ApiError, elasticsearch.TransportError) as exc:
            raise SearchInfrastructureError("product catalog is unavailable") from exc
        overlay = self._overlay([str(item.get("product_id") or "") for item in result.items])
        return {
            "items": [
                {"product_id": str(item.get("product_id") or ""), "title": str(item.get("title") or ""), "image_url": _optional_str(item.get("image_url")), "brand": _optional_str(item.get("brand")), "category": _optional_str(item.get("category")), "price": (overlay.get(str(item.get("product_id") or "")) or {}).get("price")}
                for item in result.items
            ],
            "total": result.total,
            "page": page,
            "page_size": page_size,
            "facets": {"category": [{"value": value, "label": humanize_category(value), "count": count} for value, count in result.category_facets]},
        }

    def get_product(self, product_id: str) -> dict[str, Any]:
        try:
            source = self.repository.get_product(product_id)
        except (ProductIndexMissing, elasticsearch.ApiError, elasticsearch.TransportError) as exc:
            raise SearchInfrastructureError("product catalog is unavailable") from exc
        if source is None:
            raise ProductNotFound(f"product not found: {product_id}")
        metadata = source.get("metadata") if isinstance(source.get("metadata"), dict) else {}
        attributes = source.get("attributes") if isinstance(source.get("attributes"), dict) else {}
        bullet_points = metadata.get("bullet_points") if isinstance(metadata.get("bullet_points"), list) else []
        node_paths = metadata.get("node_paths") if isinstance(metadata.get("node_paths"), list) else []
        first_path = node_paths[0] if node_paths and isinstance(node_paths[0], str) else ""
        category = _optional_str(source.get("category"))
        return {
            "product_id": str(source.get("product_id") or product_id),
            "title": str(source.get("title") or ""),
            "brand": _optional_str(source.get("brand")),
            "category": category,
            "category_label": humanize_category(category) if category else None,
            "description": str(source.get("description") or ""),
            "attributes": {str(key): str(value) for key, value in attributes.items()},
            "bullet_points": [item for item in bullet_points if isinstance(item, str)],
            "category_path": [segment for segment in first_path.split("/") if segment],
            "image_url": _optional_str(source.get("image_url")),
            "images": [url for url in [_optional_str(source.get("image_url"))] if url],
            **{key: value for key, value in (self._overlay([product_id]).get(product_id) or {}).items() if key in {"price", "stock"}},
        }
