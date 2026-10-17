from __future__ import annotations

import json
import threading
from collections.abc import Iterator, Sequence

from shopmind.infrastructure.llm.answer_stream import AnswerFieldExtractor
from shopmind.infrastructure.llm.base import InvalidLLMOutput, LLMProviderError, LLMRequest, LLMResponse

# Responses API stream event types, verified against openai 3.31.0.
EVENT_TEXT_DELTA = "response.output_text.delta"
EVENT_COMPLETED = "response.completed"
EVENT_FAILED = "response.failed"
EVENT_INCOMPLETE = "response.incomplete"
EVENT_REFUSAL_DELTA = "response.refusal.delta"
EVENT_ERROR = "error"

REWRITE_MAX_CHARS = 500


def _default_rewrite_instructions() -> str:
    from shopmind.infrastructure.llm.prompts import default_prompts

    return default_prompts().get("rewrite").text


def _answer_schema() -> dict:
    return {
        "type": "object",
        "properties": {
            "answer": {"type": "string"},
            "citation_ids": {"type": "array", "items": {"type": "string"}},
            "insufficient_evidence": {"type": "boolean"},
        },
        "required": ["answer", "citation_ids", "insufficient_evidence"],
        "additionalProperties": False,
    }


def _answer_input(request: LLMRequest) -> list[dict[str, str]]:
    return [
        {"role": "system", "content": request.instructions},
        {"role": "user", "content": f"Question: {request.question}\n\nEvidence (JSON lines):\n{request.rendered_context}\n\nAllowed citation IDs: {list(request.allowed_citation_ids)}"},
    ]


def _parse_answer(response, default_model: str) -> LLMResponse:
    try:
        raw = json.loads(response.output_text)
        if not isinstance(raw, dict) or not isinstance(raw.get("answer"), str) or not raw["answer"].strip() or not isinstance(raw.get("citation_ids"), list) or not all(isinstance(item, str) for item in raw["citation_ids"]) or not isinstance(raw.get("insufficient_evidence"), bool):
            raise ValueError("invalid response shape")
        usage = getattr(response, "usage", None)
        metadata = {"provider": "openai", "model": getattr(response, "model", default_model), "response_id": getattr(response, "id", None)}
        if usage is not None:
            metadata["usage"] = {"input_tokens": getattr(usage, "input_tokens", None), "output_tokens": getattr(usage, "output_tokens", None)}
        return LLMResponse(raw["answer"], tuple(raw["citation_ids"]), raw["insufficient_evidence"], metadata)
    except (ValueError, TypeError, AttributeError) as exc:
        raise InvalidLLMOutput("answer generation returned invalid structured output") from exc


def _json_schema_format(name: str, schema: dict) -> dict:
    return {"format": {"type": "json_schema", "name": name, "schema": schema, "strict": True}}


class OpenAIProvider:
    provider_name = "openai"

    def __init__(self, *, client=None, model: str, api_key: str | None = None, timeout: float = 60.0, rewrite_instructions: str | None = None) -> None:
        if client is None:
            try:
                from openai import OpenAI
            except ImportError as exc:
                raise LLMProviderError("install the openai package to enable RAG generation") from exc
            client = OpenAI(api_key=api_key, timeout=timeout)
        self.client = client
        self.model = model
        self.rewrite_instructions = rewrite_instructions or _default_rewrite_instructions()

    def generate(self, request: LLMRequest) -> LLMResponse:
        try:
            response = self.client.responses.create(
                model=self.model,
                store=False,
                input=_answer_input(request),
                text=_json_schema_format(request.schema_version, _answer_schema()),
            )
        except Exception as exc:
            raise LLMProviderError("answer generation is unavailable") from exc
        return _parse_answer(response, self.model)

    def generate_stream(self, request: LLMRequest, cancelled: threading.Event | None = None) -> Iterator[str | LLMResponse]:
        try:
            stream = self.client.responses.create(
                model=self.model,
                store=False,
                stream=True,
                input=_answer_input(request),
                text=_json_schema_format(request.schema_version, _answer_schema()),
            )
        except Exception as exc:
            raise LLMProviderError("answer generation is unavailable") from exc
        extractor = AnswerFieldExtractor()
        try:
            with stream:
                for event in stream:
                    if cancelled is not None and cancelled.is_set():
                        return
                    kind = getattr(event, "type", None)
                    if kind == EVENT_TEXT_DELTA:
                        text = extractor.feed(event.delta)
                        if text:
                            yield text
                    elif kind == EVENT_COMPLETED:
                        final = event.response
                        yield _parse_answer(final, self.model)
                        return
                    elif kind in (EVENT_FAILED, EVENT_ERROR):
                        raise LLMProviderError("answer generation failed")
                    elif kind in (EVENT_INCOMPLETE, EVENT_REFUSAL_DELTA):
                        raise InvalidLLMOutput("answer generation did not produce a complete answer")
                raise LLMProviderError("answer stream ended before completion")
        except (LLMProviderError, InvalidLLMOutput):
            raise
        except Exception as exc:
            raise LLMProviderError("answer generation is unavailable") from exc

    def rewrite_question(self, history: Sequence[tuple[str, str]], message: str, product: tuple[str, str] | None = None) -> str:
        lines = []
        if product is not None:
            lines.append(f"Currently viewed product: {json.dumps({'product_id': product[0], 'title': product[1]}, ensure_ascii=False)}")
        lines.append("Conversation (JSON lines):")
        lines.extend(json.dumps({"role": role, "content": content}, ensure_ascii=False) for role, content in history)
        lines.append(f"Latest message: {json.dumps(message, ensure_ascii=False)}")
        schema = {"type": "object", "properties": {"question": {"type": "string"}}, "required": ["question"], "additionalProperties": False}
        try:
            response = self.client.responses.create(
                model=self.model,
                store=False,
                input=[{"role": "system", "content": self.rewrite_instructions}, {"role": "user", "content": "\n".join(lines)}],
                text=_json_schema_format("question_rewrite_v1", schema),
            )
            output_text = response.output_text
        except Exception as exc:
            raise LLMProviderError("question rewrite is unavailable") from exc
        try:
            question = json.loads(output_text)["question"]
            if not isinstance(question, str):
                raise TypeError("question must be a string")
        except (ValueError, TypeError, KeyError) as exc:
            raise InvalidLLMOutput("question rewrite returned invalid structured output") from exc
        question = question.strip()
        if not question or len(question) > REWRITE_MAX_CHARS:
            raise InvalidLLMOutput("question rewrite returned an empty or oversized question")
        return question

    def generate_structured(self, instructions: str, user_content: str, schema: dict, name: str) -> dict:
        """One structured-output call (compare, query understanding)."""
        try:
            response = self.client.responses.create(model=self.model, store=False, input=[{"role": "system", "content": instructions}, {"role": "user", "content": user_content}], text=_json_schema_format(name, schema))
            output_text = response.output_text
        except Exception as exc:
            raise LLMProviderError("structured generation is unavailable") from exc
        try:
            value = json.loads(output_text)
        except (TypeError, ValueError) as exc:
            raise InvalidLLMOutput("structured generation returned invalid JSON") from exc
        if not isinstance(value, dict):
            raise InvalidLLMOutput("structured generation must return an object")
        return value

    def understand_query(self, message: str, allowed: dict[str, list[str]], prompt: str) -> dict:
        return self.generate_structured(prompt, f"Allowed values (JSON): {json.dumps(allowed, ensure_ascii=False)}\n\nRequest: {json.dumps(message, ensure_ascii=False)}", understanding_schema(), "query_understanding_v1")


def understanding_schema() -> dict:
    values = {"type": "array", "items": {"type": "string"}}
    return {
        "type": "object",
        "properties": {
            "intent": {"type": "string", "enum": ["product_search", "product_question", "policy_question", "compare", "chitchat"]},
            "rewritten_query": {"type": "string"},
            "filters": {"type": "object", "properties": {"brand": values, "category": values, "color": values}, "required": ["brand", "category", "color"], "additionalProperties": False},
            "price_max": {"type": ["number", "null"]},
            "price_min": {"type": ["number", "null"]},
        },
        "required": ["intent", "rewritten_query", "filters", "price_max", "price_min"],
        "additionalProperties": False,
    }
