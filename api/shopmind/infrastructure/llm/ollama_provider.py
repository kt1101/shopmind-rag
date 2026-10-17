"""Local LLM through Ollama's ``/api/chat`` with JSON-schema structured output (Could: F-local).

Streaming is emulated (one full answer chunk) so the chat SSE contract stays identical; the
answer is still validated against the same citation rules as the OpenAI provider.
"""
from __future__ import annotations

import json
import threading
import urllib.error
import urllib.request
from collections.abc import Iterator, Sequence

from shopmind.infrastructure.llm.base import InvalidLLMOutput, LLMProviderError, LLMRequest, LLMResponse

_ANSWER_SCHEMA = {"type": "object", "properties": {"answer": {"type": "string"}, "citation_ids": {"type": "array", "items": {"type": "string"}}, "insufficient_evidence": {"type": "boolean"}}, "required": ["answer", "citation_ids", "insufficient_evidence"]}


class OllamaProvider:
    provider_name = "ollama"

    def __init__(self, *, model: str, base_url: str = "http://localhost:11434", timeout: float = 120.0, rewrite_instructions: str = "") -> None:
        self.model = model
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.rewrite_instructions = rewrite_instructions

    def _chat(self, messages: list[dict[str, str]], schema: dict) -> dict:
        body = json.dumps({"model": self.model, "messages": messages, "stream": False, "format": schema, "options": {"temperature": 0}}).encode("utf-8")
        request = urllib.request.Request(f"{self.base_url}/api/chat", data=body, headers={"content-type": "application/json"})
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            raise LLMProviderError("local LLM is unavailable") from exc
        try:
            return json.loads(payload["message"]["content"]), payload
        except (KeyError, TypeError, ValueError) as exc:
            raise InvalidLLMOutput("local LLM returned invalid structured output") from exc

    def generate(self, request: LLMRequest) -> LLMResponse:
        raw, payload = self._chat([
            {"role": "system", "content": request.instructions},
            {"role": "user", "content": f"Question: {request.question}\n\nEvidence (JSON lines):\n{request.rendered_context}\n\nAllowed citation IDs: {list(request.allowed_citation_ids)}"},
        ], _ANSWER_SCHEMA)
        if not isinstance(raw, dict) or not isinstance(raw.get("answer"), str) or not raw["answer"].strip() or not isinstance(raw.get("citation_ids"), list) or not isinstance(raw.get("insufficient_evidence"), bool):
            raise InvalidLLMOutput("local LLM returned an invalid answer shape")
        usage = {"input_tokens": payload.get("prompt_eval_count"), "output_tokens": payload.get("eval_count")}
        return LLMResponse(raw["answer"], tuple(str(item) for item in raw["citation_ids"]), raw["insufficient_evidence"], {"provider": "ollama", "model": self.model, "usage": usage})

    def generate_stream(self, request: LLMRequest, cancelled: threading.Event | None = None) -> Iterator[str | LLMResponse]:
        response = self.generate(request)
        if cancelled is not None and cancelled.is_set():
            return
        yield response.answer
        yield response

    def rewrite_question(self, history: Sequence[tuple[str, str]], message: str, product: tuple[str, str] | None = None) -> str:
        lines = [f"Currently viewed product: {json.dumps({'product_id': product[0], 'title': product[1]}, ensure_ascii=False)}"] if product else []
        lines += ["Conversation (JSON lines):", *(json.dumps({"role": role, "content": content}, ensure_ascii=False) for role, content in history), f"Latest message: {json.dumps(message, ensure_ascii=False)}"]
        raw, _ = self._chat([{"role": "system", "content": self.rewrite_instructions}, {"role": "user", "content": "\n".join(lines)}], {"type": "object", "properties": {"question": {"type": "string"}}, "required": ["question"]})
        question = str(raw.get("question") or "").strip() if isinstance(raw, dict) else ""
        if not question or len(question) > 500:
            raise InvalidLLMOutput("question rewrite returned an empty or oversized question")
        return question

    def generate_structured(self, instructions: str, user_content: str, schema: dict, name: str) -> dict:
        del name
        raw, _ = self._chat([{"role": "system", "content": instructions}, {"role": "user", "content": user_content}], schema)
        if not isinstance(raw, dict):
            raise InvalidLLMOutput("local LLM must return an object")
        return raw

    def understand_query(self, message: str, allowed: dict[str, list[str]], prompt: str) -> dict:
        from shopmind.infrastructure.llm.openai_provider import understanding_schema

        return self.generate_structured(prompt, f"Allowed values (JSON): {json.dumps(allowed, ensure_ascii=False)}\n\nRequest: {json.dumps(message, ensure_ascii=False)}", understanding_schema(), "query_understanding_v1")
