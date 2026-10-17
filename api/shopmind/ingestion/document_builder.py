from __future__ import annotations

from typing import Any

from shopmind.domain.product import Product


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


class _Blank(dict):
    def __missing__(self, key: str) -> str:
        return ""


def render_embedding_text(product: Product, template: str | None = None, *, description_chars: int | None = None) -> str:
    """Text that a dedicated text embedder sees for a product (A-2, template from config).

    Fields: title, brand, category (``home_bed_and_bath`` → ``home bed and bath``), color, material,
    attributes (all ``key: value`` lines), description (optionally truncated). Lines whose value is
    empty (``Brand: ``) are dropped, so sparse products do not embed label noise.
    """
    if not template:
        return build_search_text(product)
    attributes = {str(key).casefold(): str(value).strip() for key, value in product.attributes.items()}
    description = product.description.strip()
    if description_chars is not None and description_chars >= 0 and len(description) > description_chars:
        description = description[:description_chars].rsplit(" ", 1)[0]
    fields = _Blank(
        title=product.title.strip(),
        brand=(product.brand or "").strip(),
        category=(product.category or "").replace("_", " ").strip(),
        color=attributes.get("color", ""),
        material=attributes.get("material", ""),
        attributes="\n".join(f"{key}: {product.attributes[key]}" for key in sorted(product.attributes) if str(key).casefold() not in {"color", "material"}),
        description=description,
    )
    lines = []
    for line in template.replace("\\n", "\n").format_map(fields).splitlines():
        stripped = line.strip()
        if not stripped or (stripped.endswith(":") and ":" in stripped and stripped.count(":") == 1):
            continue
        lines.append(stripped)
    return "\n".join(lines)


def product_to_processed_record(product: Product) -> dict[str, Any]:
    return {"product_id": product.product_id, "title": product.title, "description": product.description, "brand": product.brand, "category": product.category, "attributes": dict(product.attributes), "image_paths": list(product.image_paths), "main_image_path": product.main_image_path, "search_text": build_search_text(product), "metadata": dict(product.metadata)}
