from __future__ import annotations

from typing import Any

import elasticsearch

from shopmind.app.api.errors import InvalidFilter, InvalidPagination, ProductNotFound, SearchInfrastructureError
from shopmind.app.infrastructure.elasticsearch.repository import ProductIndexMissing

MAX_RESULT_WINDOW = 10000


def humanize_category(value: str) -> str:
    return " ".join(word.capitalize() for word in value.split("_"))


def _optional_str(value: Any) -> str | None:
    return value if isinstance(value, str) and value else None


def _clean(values: list[str]) -> list[str]:
    return [stripped for value in values if (stripped := value.strip())]


class CatalogService:
    def __init__(self, repository: Any) -> None:
        self.repository = repository

    def list_products(self, *, categories: list[str], brands: list[str], limit: int, offset: int) -> dict[str, Any]:
        if offset + limit > MAX_RESULT_WINDOW:
            raise InvalidPagination(f"offset + limit must be <= {MAX_RESULT_WINDOW}")
        filters = {key: values for key, values in (("category", _clean(categories)), ("brand", _clean(brands))) if values}
        try:
            result = self.repository.list_products(filters, offset, limit)
        except ValueError as exc:
            raise InvalidFilter(str(exc)) from exc
        except (ProductIndexMissing, elasticsearch.ApiError, elasticsearch.TransportError) as exc:
            raise SearchInfrastructureError("product catalog is unavailable") from exc
        return {
            "items": [
                {"product_id": str(item.get("product_id") or ""), "title": str(item.get("title") or ""), "image_url": _optional_str(item.get("image_url")), "brand": _optional_str(item.get("brand")), "category": _optional_str(item.get("category"))}
                for item in result.items
            ],
            "total": result.total,
            "limit": limit,
            "offset": offset,
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
            "attributes": [{"name": humanize_category(str(key)), "value": str(value)} for key, value in attributes.items()],
            "bullet_points": [item for item in bullet_points if isinstance(item, str)],
            "category_path": [segment for segment in first_path.split("/") if segment],
            "image_url": _optional_str(source.get("image_url")),
        }
