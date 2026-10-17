from __future__ import annotations

from typing import Protocol, Sequence, runtime_checkable

import numpy as np
from PIL import Image


@runtime_checkable
class EmbeddingProvider(Protocol):
    """Stable multimodal embedding contract independent of the search store."""

    model_name: str
    model_revision: str | None
    dimension: int
    is_ready: bool

    def embed_texts(self, texts: Sequence[str]) -> np.ndarray:
        """Return float32 embeddings with shape ``(len(texts), dimension)``."""
        ...

    def embed_images(self, images: Sequence[Image.Image]) -> np.ndarray:
        """Return float32 embeddings with shape ``(len(images), dimension)``."""
        ...
