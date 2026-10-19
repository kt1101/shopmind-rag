"""Query-time embedding cache (runtime only; offline ingestion never goes through it).

Shoppers repeat queries (pagination, the inspector re-running a search, the compose α slider
re-sending the same photo), and every repeat re-ran E5 or SigLIP2 on the CPU. ``CachingEmbedder``
wraps an embedder with two bounded LRU caches: single query texts (``embed_queries`` and
``embed_texts``) and images keyed by a SHA-256 of their pixels. Everything else (identity,
dimension, preprocessing) is delegated, so index identity checks are unaffected. Returned arrays
are copies: callers can never mutate a cached vector.
"""
from __future__ import annotations

import hashlib
import threading
from collections import OrderedDict
from collections.abc import Sequence
from typing import Any

import numpy as np


class _LRU:
    def __init__(self, capacity: int) -> None:
        self.capacity = capacity
        self._items: OrderedDict[Any, np.ndarray] = OrderedDict()
        self._lock = threading.Lock()
        self.hits = 0
        self.misses = 0

    def get(self, key: Any) -> np.ndarray | None:
        with self._lock:
            value = self._items.get(key)
            if value is None:
                self.misses += 1
                return None
            self._items.move_to_end(key)
            self.hits += 1
            return value

    def put(self, key: Any, value: np.ndarray) -> None:
        with self._lock:
            self._items[key] = value
            self._items.move_to_end(key)
            while len(self._items) > self.capacity:
                self._items.popitem(last=False)


def image_key(image: Any) -> str:
    digest = hashlib.sha256()
    digest.update(f"{getattr(image, 'mode', '')}:{getattr(image, 'size', '')}".encode())
    digest.update(image.tobytes())
    return digest.hexdigest()


class CachingEmbedder:
    def __init__(self, inner: Any, *, text_capacity: int = 2048, image_capacity: int = 64) -> None:
        self.inner = inner
        self._texts = _LRU(text_capacity)
        self._images = _LRU(image_capacity)

    def __getattr__(self, name: str) -> Any:  # identity, dimension, model_name, … come from the wrapped embedder
        return getattr(self.inner, name)

    def _cached(self, kind: str, texts: Sequence[str], encode) -> np.ndarray:
        if len(texts) != 1:  # batches (ingestion) are not cached
            return encode(texts)
        key = (kind, texts[0])
        hit = self._texts.get(key)
        if hit is None:
            hit = np.asarray(encode(texts), dtype=np.float32)
            self._texts.put(key, hit)
        return hit.copy()

    def embed_texts(self, texts: Sequence[str]) -> np.ndarray:
        return self._cached("text", list(texts), self.inner.embed_texts)

    def embed_queries(self, texts: Sequence[str]) -> np.ndarray:
        encode = getattr(self.inner, "embed_queries", None)
        if encode is None:
            return self.embed_texts(texts)
        return self._cached("query", list(texts), encode)

    def embed_images(self, images: Sequence[Any]) -> np.ndarray:
        images = list(images)
        if len(images) != 1:
            return self.inner.embed_images(images)
        key = image_key(images[0])
        hit = self._images.get(key)
        if hit is None:
            hit = np.asarray(self.inner.embed_images(images), dtype=np.float32)
            self._images.put(key, hit)
        return hit.copy()

    def cache_stats(self) -> dict[str, int]:
        return {"text_hits": self._texts.hits, "text_misses": self._texts.misses, "image_hits": self._images.hits, "image_misses": self._images.misses}
