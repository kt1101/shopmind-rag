"""Embedders by config name (``embedders:`` in configs/components/embedders.yaml).

Implementations register under kind ``embedder``; ``build_embedders`` instantiates every
configured embedder once. Without an ``embedders:`` section the legacy single ``embedding:``
SigLIP2 model is exposed as ``siglip2`` and bound to both product vector fields.
"""
from __future__ import annotations

from typing import Any

from shopmind.core.config import AppConfig, EmbedderSpec
from shopmind.core.registry import register, resolve

LEGACY_EMBEDDER_ID = "siglip2"


@register("embedder", "siglip2")
def _siglip2(spec: EmbedderSpec, *, device: str | None = None, hf_token: str | None = None, **_: Any):
    from shopmind.infrastructure.embedding.siglip2 import SigLIP2EmbeddingProvider

    return SigLIP2EmbeddingProvider(model_name=spec.model_name, model_revision=spec.revision, device=device, hf_token=hf_token)


@register("embedder", "sentence_transformer")
def _sentence_transformer(spec: EmbedderSpec, *, device: str | None = None, hf_token: str | None = None, **_: Any):
    from shopmind.infrastructure.embedding.sentence_transformer import SentenceTransformerEmbedder

    params = dict(spec.params)
    return SentenceTransformerEmbedder(spec.model_name, spec.revision, device=device, hf_token=hf_token, query_prefix=params.get("query_prefix", ""), passage_prefix=params.get("passage_prefix", ""), max_seq_length=params.get("max_seq_length"), batch_size=int(params.get("batch_size", 32)), document_template=params.get("document_template"), description_chars=params.get("description_chars"))


def embedder_specs(config: AppConfig) -> dict[str, EmbedderSpec]:
    if config.embedders:
        return dict(config.embedders)
    return {LEGACY_EMBEDDER_ID: EmbedderSpec(impl="siglip2", model_name=config.embedding.model_name, revision=config.embedding.model_revision, modalities=["text", "image"])}


def field_embedder_ids(config: AppConfig, index: str = "products") -> dict[str, str]:
    """Vector field → embedder id for a logical index (legacy: SigLIP2 for everything)."""
    spec = config.indexes.get(index)
    vectors = dict(spec.vectors) if spec is not None else {}
    if vectors:
        return vectors
    if index == "products":
        return {"text_vector": LEGACY_EMBEDDER_ID, "image_vector": LEGACY_EMBEDDER_ID}
    return {"text_vector": LEGACY_EMBEDDER_ID}


def build_embedder(config: AppConfig, embedder_id: str, *, device: str | None = None) -> Any:
    specs = embedder_specs(config)
    if embedder_id not in specs:
        raise KeyError(f"unknown embedder {embedder_id!r} (configured: {', '.join(sorted(specs))})")
    spec = specs[embedder_id]
    embedder = resolve("embedder", spec.impl)(spec, device=device, hf_token=config.embedding.hf_token)
    embedder.embedder_id = embedder_id
    return embedder


def build_embedders(config: AppConfig, ids: list[str] | None = None, *, device: str | None = None) -> dict[str, Any]:
    wanted = ids if ids is not None else list(dict.fromkeys(field_embedder_ids(config, "products").values()))
    return {embedder_id: build_embedder(config, embedder_id, device=device) for embedder_id in wanted}


def embed_query(embedder: Any, text: str):
    """One query vector, using the asymmetric query encoder when the embedder has one."""
    encode = getattr(embedder, "embed_queries", None) or embedder.embed_texts
    return encode([text])
