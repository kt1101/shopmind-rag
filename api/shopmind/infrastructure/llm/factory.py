"""LLM providers by config name (``rag.llm.provider``): ``openai`` (default) or ``ollama`` (local)."""
from __future__ import annotations

from typing import Any

from shopmind.core.registry import register, resolve
from shopmind.infrastructure.llm.prompts import PromptLibrary, default_prompts


@register("llm", "openai")
def _openai(config: Any, prompts: PromptLibrary):
    if not config.api_key:
        return None  # search keeps working; RAG/chat answer 503 llm_unavailable
    from shopmind.infrastructure.llm.openai_provider import OpenAIProvider

    return OpenAIProvider(model=config.model, api_key=config.api_key, timeout=config.timeout_seconds, rewrite_instructions=prompts.get("rewrite").text)


@register("llm", "ollama")
def _ollama(config: Any, prompts: PromptLibrary):
    from shopmind.infrastructure.llm.ollama_provider import OllamaProvider

    return OllamaProvider(model=config.model, base_url=config.base_url, timeout=config.timeout_seconds, rewrite_instructions=prompts.get("rewrite").text)


def build_llm(config: Any, prompts: PromptLibrary | None = None):
    return resolve("llm", config.provider)(config, prompts or default_prompts())
