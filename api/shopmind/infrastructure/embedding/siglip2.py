from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image


class SigLIP2EmbeddingProvider:
    """Hugging Face SigLIP2 adapter for aligned text/image embeddings."""

    def __init__(self, model_name: str, model_revision: str | None = None, *, device: str | torch.device | None = None, hf_token: str | None = None, processor: Any | None = None, model: Any | None = None) -> None:
        self.model_name = model_name
        self.model_revision = model_revision
        self.device = torch.device(device or ("cuda" if torch.cuda.is_available() else "cpu"))
        if processor is None or model is None:
            try:
                from transformers import AutoModel, AutoProcessor
            except ImportError as exc:
                raise RuntimeError("transformers is required when SigLIP2 processor/model are not injected") from exc
            load_kwargs: dict[str, Any] = {}
            if model_revision:
                load_kwargs["revision"] = model_revision
            if hf_token:
                load_kwargs["token"] = hf_token
            if processor is None:
                processor = AutoProcessor.from_pretrained(model_name, **load_kwargs)
            if model is None:
                model = AutoModel.from_pretrained(model_name, **load_kwargs)
        self.processor = processor
        self.model = model.to(self.device)
        self.model.eval()
        self.dimension = self._resolve_dimension(self.model)
        self.model_revision = getattr(self.model.config, "_commit_hash", None) or model_revision
        self.text_preprocessing = {"padding": "max_length", "max_length": 64, "truncation": True}
        image_processor = getattr(processor, "image_processor", None)
        self.image_preprocessing = {"processor": type(image_processor).__name__,
                                    "config": image_processor.to_dict() if image_processor is not None else {}}
        self.is_ready = True

    @staticmethod
    def _resolve_dimension(model: Any) -> int:
        config = getattr(model, "config", None)
        if config is None:
            raise ValueError("embedding model must expose a config with output dimension")
        candidates: list[Any] = [getattr(config, "projection_dim", None), getattr(config, "projection_size", None)]
        for nested_name in ("text_config", "vision_config"):
            nested = getattr(config, nested_name, None)
            if nested is not None:
                candidates.extend([getattr(nested, "projection_dim", None), getattr(nested, "projection_size", None), getattr(nested, "hidden_size", None)])
        candidates.append(getattr(config, "hidden_size", None))
        for value in candidates:
            if isinstance(value, int) and value > 0:
                return value
        raise ValueError("could not determine embedding dimension from model config")

    def _to_device(self, inputs: Any) -> Mapping[str, Any]:
        if hasattr(inputs, "to"):
            moved = inputs.to(self.device)
            if isinstance(moved, Mapping):
                return moved
        if not isinstance(inputs, Mapping):
            raise TypeError("processor output must be a mapping or support .to(device)")
        return {key: value.to(self.device) if hasattr(value, "to") else value for key, value in inputs.items()}

    def _normalize_numpy(self, features: torch.Tensor) -> np.ndarray:
        if features.ndim != 2:
            raise ValueError(f"expected 2D feature tensor, got shape {tuple(features.shape)}")
        if features.shape[1] != self.dimension:
            raise ValueError(f"model returned feature dimension {features.shape[1]}, expected {self.dimension}")
        norms = torch.linalg.vector_norm(features.float(), dim=1)
        if not torch.isfinite(features).all() or not torch.isfinite(norms).all() or torch.any(norms <= 1e-12):
            raise ValueError("model features must be finite with nonzero norm")
        normalized = F.normalize(features.float(), p=2, dim=1)
        return normalized.detach().cpu().numpy().astype(np.float32, copy=False)

    def embed_texts(self, texts: Sequence[str]) -> np.ndarray:
        if not texts:
            return np.empty((0, self.dimension), dtype=np.float32)
        inputs = self.processor(text=list(texts), padding="max_length", max_length=64, truncation=True, return_tensors="pt")
        moved = self._to_device(inputs)
        with torch.inference_mode():
            features = self.model.get_text_features(**moved)
        return self._normalize_numpy(features)

    def embed_images(self, images: Sequence[Image.Image]) -> np.ndarray:
        if not images:
            return np.empty((0, self.dimension), dtype=np.float32)
        inputs = self.processor(images=list(images), return_tensors="pt")
        moved = self._to_device(inputs)
        with torch.inference_mode():
            features = self.model.get_image_features(**moved)
        return self._normalize_numpy(features)
