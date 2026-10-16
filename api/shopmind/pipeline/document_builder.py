from __future__ import annotations

from typing import Any

from shopmind.app.domain.product import Product


def build_search_text(product: Product) -> str:
    lines = [product.title.strip()]
    if product.brand:
        lines.append(f"Brand: {product.brand.strip()}")
    if product.category:
        lines.append(f"Category: {product.category.strip()}")
    if product.description.strip():
        lines.append(product.description.strip())
    for key in sorted(product.attributes):
        lines.append(f"{key}: {product.attributes[key]}")
    return "\n".join(line for line in lines if line)


def product_to_processed_record(product: Product) -> dict[str, Any]:
    return {"product_id": product.product_id, "title": product.title, "description": product.description, "brand": product.brand, "category": product.category, "attributes": dict(product.attributes), "image_paths": list(product.image_paths), "main_image_path": product.main_image_path, "search_text": build_search_text(product), "metadata": dict(product.metadata)}
