from __future__ import annotations

from typing import Protocol

import numpy as np
from PIL import Image

from shopmind.app.domain.search_query import SearchRequest
from shopmind.app.domain.search_result import RawSearchHit, RetrievalScores, SearchResult
from shopmind.app.embedding.base import EmbeddingProvider
from shopmind.app.embedding.validation import validate_vectors


class _VectorRepository(Protocol):
    def vector_search(self, field: str, vector: list[float], size: int, num_candidates: int, filters: dict[str, str | list[str]]) -> list[RawSearchHit]: ...


def _single_vector(matrix: np.ndarray, dimension: int, *, kind: str) -> list[float]:
    if matrix.shape != (1, dimension):
        raise ValueError(f"{kind} embedding provider must return shape (1, {dimension})")
    validate_vectors(matrix, dimension)
    if matrix.dtype != np.float32:
        matrix = matrix.astype(np.float32)
    return matrix[0].tolist()


def _map_hits(hits: list[RawSearchHit], *, top_k: int, source: str) -> list[SearchResult]:
    return [SearchResult(product_id=hit.product_id, title=hit.title, rank=rank, score=hit.score, source=source, metadata=dict(hit.metadata), retrieval_scores=RetrievalScores(dense_rank=rank)) for rank, hit in enumerate(hits[:top_k], start=1)]


class TextDenseRetriever:
    def __init__(self, repository: _VectorRepository, embedder: EmbeddingProvider) -> None:
        self.repository = repository
        self.embedder = embedder

    def search(self, request: SearchRequest) -> list[SearchResult]:
        if hasattr(self.repository, "bind_embedding"):
            self.repository.bind_embedding(self.embedder)
        vector = _single_vector(self.embedder.embed_texts([request.query]), self.embedder.dimension, kind="text")
        hits = self.repository.vector_search("text_vector", vector, size=request.candidate_k, num_candidates=request.candidate_k, filters=request.filters)
        return _map_hits(hits, top_k=request.top_k, source="dense")


class CrossModalRetriever:
    def __init__(self, repository: _VectorRepository, embedder: EmbeddingProvider) -> None:
        self.repository = repository
        self.embedder = embedder

    def search(self, request: SearchRequest) -> list[SearchResult]:
        if hasattr(self.repository, "bind_embedding"):
            self.repository.bind_embedding(self.embedder, "image_vector", "image")
        vector = _single_vector(self.embedder.embed_texts([request.query]), self.embedder.dimension, kind="text")
        hits = self.repository.vector_search("image_vector", vector, size=request.candidate_k, num_candidates=request.candidate_k, filters=request.filters)
        return _map_hits(hits, top_k=request.top_k, source="cross_modal")


class ImageDenseRetriever:
    def __init__(self, repository: _VectorRepository, embedder: EmbeddingProvider) -> None:
        self.repository = repository
        self.embedder = embedder

    def search_image(self, image: Image.Image, top_k: int = 10, candidate_k: int = 100, filters: dict[str, str | list[str]] | None = None) -> list[SearchResult]:
        if top_k <= 0:
            raise ValueError("top_k must be positive")
        if candidate_k < top_k:
            raise ValueError("candidate_k must be >= top_k")
        if hasattr(self.repository, "bind_embedding"):
            self.repository.bind_embedding(self.embedder, "image_vector", "image")
        vector = _single_vector(self.embedder.embed_images([image]), self.embedder.dimension, kind="image")
        hits = self.repository.vector_search("image_vector", vector, size=candidate_k, num_candidates=candidate_k, filters=filters or {})
        return _map_hits(hits, top_k=top_k, source="image_dense")
