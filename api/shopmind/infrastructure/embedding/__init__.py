"""Embedding provider abstractions and model adapters."""

from .base import EmbeddingProvider
from .siglip2 import SigLIP2EmbeddingProvider

__all__ = ["EmbeddingProvider", "SigLIP2EmbeddingProvider"]
