from __future__ import annotations

import re
from collections.abc import Iterable, Mapping
from typing import Any

from shopmind.app.domain.product import Product

_WHITESPACE_RE = re.compile(r"\s+")


def _clean_text(value: Any) -> str | None:
    if value is None:
        return None
    text = _WHITESPACE_RE.sub(" ", str(value)).strip()
    return text or None


def _localized_value(value: Any) -> str | None:
    if isinstance(value, str):
        return _clean_text(value)
    if isinstance(value, Mapping):
        return _clean_text(value.get("value") or value.get("text") or value.get("name"))
    if not isinstance(value, Iterable):
        return _clean_text(value)
    entries = list(value)
    for entry in entries:
        if isinstance(entry, Mapping):
            language = str(entry.get("language_tag") or entry.get("language") or "").lower()
            candidate = _clean_text(entry.get("value") or entry.get("text") or entry.get("name"))
            if candidate and language.startswith("en"):
                return candidate
    for entry in entries:
        candidate = _localized_value(entry)
        if candidate:
            return candidate
    return None


def _localized_values(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, (str, Mapping)):
        candidate = _localized_value(value)
        return [candidate] if candidate else []
    if not isinstance(value, Iterable):
        candidate = _clean_text(value)
        return [candidate] if candidate else []
    english: list[str] = []
    fallback: list[str] = []
    for entry in value:
        if isinstance(entry, Mapping):
            candidate = _clean_text(entry.get("value") or entry.get("text") or entry.get("name"))
            if not candidate:
                continue
            language = str(entry.get("language_tag") or entry.get("language") or "").lower()
            (english if language.startswith("en") else fallback).append(candidate)
        else:
            candidate = _clean_text(entry)
            if candidate:
                fallback.append(candidate)
    return english or fallback


def _normalize_attributes(raw: Any) -> dict[str, str]:
    if not isinstance(raw, Mapping):
        return {}
    normalized: dict[str, str] = {}
    for key in sorted(raw, key=lambda item: str(item)):
        clean_key = _clean_text(key)
        if not clean_key:
            continue
        clean_value = _localized_value(raw[key])
        if clean_value:
            normalized[clean_key] = clean_value
    return normalized


def _image_ids(record: Mapping[str, Any]) -> list[str]:
    ids: list[str] = []
    main = _clean_text(record.get("main_image_id"))
    if main:
        ids.append(main)
    others = record.get("other_image_id") or []
    if isinstance(others, str):
        others = [others]
    if isinstance(others, Iterable):
        for value in others:
            image_id = _clean_text(value)
            if image_id and image_id not in ids:
                ids.append(image_id)
    return ids


def normalize_abo_record(record: Mapping[str, Any], image_lookup: Mapping[str, str]) -> Product:
    product_id = _clean_text(record.get("item_id") or record.get("product_id") or record.get("id"))
    if not product_id:
        raise ValueError("ABO record is missing item_id")
    title = _localized_value(record.get("item_name") or record.get("title")) or product_id
    brand = _localized_value(record.get("brand"))
    category = _localized_value(record.get("product_type") or record.get("category"))
    bullet_points = _localized_values(record.get("bullet_point"))
    description = " ".join(bullet_points)
    if not description:
        description = _localized_value(record.get("description")) or ""
    image_ids = _image_ids(record)
    mapped_paths = tuple(image_lookup[image_id] for image_id in image_ids if image_id in image_lookup)
    unmapped = [image_id for image_id in image_ids if image_id not in image_lookup]
    metadata: dict[str, Any] = {"source_item_id": product_id, "image_ids": image_ids}
    if unmapped:
        metadata["unmapped_image_ids"] = unmapped
    for key in ("item_keywords", "node", "country", "marketplace"):
        if key in record:
            metadata[key] = record[key]
    return Product(product_id=product_id, title=title, description=description, brand=brand, category=category, attributes=_normalize_attributes(record.get("attributes")), image_paths=mapped_paths, metadata=metadata)
