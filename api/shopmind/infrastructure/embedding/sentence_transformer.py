"""Dedicated text embedder (E5 / BGE family) via sentence-transformers (ADR 0001).

SigLIP2 stays the image and cross-modal embedder; this adapter only embeds text, so
``embed_images`` raises. E5-style models need asymmetric prefixes: documents are embedded
with ``passage_prefix`` (``embed_texts``) and search queries with ``query_prefix``
(``embed_queries``). Both prefixes are part of the preprocessing identity, so an index built
with one prefix pair can never be queried with another.
"""
from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import numpy as np
from PIL import Image


class SentenceTransformerEmbedder:
    def __init__(self, model_name: str, model_revision: str | None = None, *, device: str | None = None, hf_token: str | None = None, query_prefix: str = "", passage_prefix: str = "", max_seq_length: int | None = None, batch_size: int = 32, document_template: str | None = None, description_chars: int | None = None, model: Any | None = None) -> None:
        if model is None:
            try:
                from sentence_transformers import SentenceTransformer
            except ImportError as exc:
                raise RuntimeError("install the 'text-embed' extra (sentence-transformers) to use a dedicated text embedder") from exc
            kwargs: dict[str, Any] = {"device": device or "cpu"}
            if model_revision:
                kwargs["revision"] = model_revision
            if hf_token:
                kwargs["token"] = hf_token
            model = SentenceTransformer(model_name, **kwargs)
        if max_seq_length:
            model.max_seq_length = int(max_seq_length)
        self.model = model
        self.model_name = model_name
        self.model_revision = _resolved_revision(model) or model_revision
        self.query_prefix = query_prefix
        self.passage_prefix = passage_prefix
        self.batch_size = batch_size
        # A-2: how a product is rendered into the embedded passage (part of the index identity).
        self.document_template = document_template
        self.description_chars = description_chars
        self.dimension = int((getattr(model, "get_embedding_dimension", None) or model.get_sentence_embedding_dimension)())
        self.normalized = True
        self.text_preprocessing = {"query_prefix": query_prefix, "passage_prefix": passage_prefix, "max_seq_length": int(getattr(model, "max_seq_length", 0) or 0), "normalize": True, "document_template": document_template, "description_chars": description_chars}
        self.image_preprocessing = None
        self.text_only = True
        self.is_ready = True

    def _encode(self, texts: Sequence[str]) -> np.ndarray:
        if not texts:
            return np.empty((0, self.dimension), dtype=np.float32)
        vectors = self.model.encode(list(texts), batch_size=self.batch_size, normalize_embeddings=True, convert_to_numpy=True, show_progress_bar=False)
        return np.asarray(vectors, dtype=np.float32)

    def embed_texts(self, texts: Sequence[str]) -> np.ndarray:
        """Embed documents (passages)."""
        return self._encode([f"{self.passage_prefix}{text}" for text in texts])

    def embed_queries(self, texts: Sequence[str]) -> np.ndarray:
        """Embed search queries (asymmetric prefix)."""
        return self._encode([f"{self.query_prefix}{text}" for text in texts])

    def embed_images(self, images: Sequence[Image.Image]) -> np.ndarray:
        raise NotImplementedError(f"{self.model_name} is a text-only embedder")


def _resolved_revision(model: Any) -> str | None:
    """The commit hash the weights were loaded from, so the index identity pins the real snapshot."""
    try:
        first = model[0]
        config = getattr(getattr(first, "auto_model", None), "config", None)
        return getattr(config, "_commit_hash", None)
    except Exception:
        return None
