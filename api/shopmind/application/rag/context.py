from __future__ import annotations

import json
from dataclasses import replace

from shopmind.domain.search_result import RetrievedDocument
from shopmind.application.rag.models import RAGContext


class ContextBuilder:
    def __init__(self, max_documents: int, source_limits: dict[str, int], max_characters: int) -> None:
        if max_documents <= 0 or max_characters <= 0 or any(limit < 0 for limit in source_limits.values()):
            raise ValueError("context limits must be valid")
        self.max_documents = max_documents
        self.source_limits = dict(source_limits)
        self.max_characters = max_characters

    def build(self, documents: list[RetrievedDocument]) -> RAGContext:
        # Reserve a slot and text budget for each source before additional same-source hits.
        source_order = tuple(dict.fromkeys(document.source for document in documents))
        ordered = [document for source in source_order for document in documents if document.source == source] + documents
        candidates = []
        counts: dict[str, int] = {}
        seen = set()
        minimum_used = 0
        for position, document in enumerate(ordered):
            if position < len(documents) and counts.get(document.source, 0):
                continue
            if document.id in seen or counts.get(document.source, 0) >= self.source_limits.get(document.source, self.max_documents):
                continue
            seen.add(document.id)
            evidence = {"id": document.id, "source": document.source, "title": document.metadata.get("title", document.id), "content": document.content}
            keys = {
                "product": ("product_id", "brand", "category", "color"),
                "review": ("product_id", "rating", "verified_purchase", "timestamp", "helpful_vote"),
                "policy": ("version", "effective_date", "policy_type", "provenance"),
            }.get(document.source, ())
            evidence.update({key: document.metadata[key] for key in keys if key in document.metadata})
            if document.source == "product" and "color" not in evidence:
                attributes = document.metadata.get("attributes")
                if isinstance(attributes, dict) and "color" in attributes:
                    evidence["color"] = attributes["color"]
            full = json.dumps(evidence, ensure_ascii=False)
            minimum = min(len(full), len(json.dumps({**evidence, "content": document.content[:1], "content_truncated": True}, ensure_ascii=False)))
            if minimum_used + minimum + bool(candidates) > self.max_characters:
                continue
            candidates.append((document, evidence, full, minimum))
            minimum_used += minimum + (1 if len(candidates) > 1 else 0)
            counts[document.source] = counts.get(document.source, 0) + 1
            if len(candidates) >= self.max_documents:
                break

        selected = []
        chunks = []
        truncated_ids = []
        remaining = self.max_characters - max(0, len(candidates) - 1)
        for index, (document, evidence, full, minimum) in enumerate(candidates):
            reserved = sum(candidate[3] for candidate in candidates[index:])
            budget = minimum + (remaining - reserved) // (len(candidates) - index)
            chunk = full
            if len(full) > budget:
                evidence["content_truncated"] = True
                low, high = 1, len(document.content)
                while low < high:
                    middle = (low + high + 1) // 2
                    evidence["content"] = document.content[:middle]
                    if len(json.dumps(evidence, ensure_ascii=False)) <= budget:
                        low = middle
                    else:
                        high = middle - 1
                evidence["content"] = document.content[:low]
                chunk = json.dumps(evidence, ensure_ascii=False)
                document = replace(document, content=evidence["content"], metadata={**document.metadata, "content_truncated": True})
                truncated_ids.append(document.id)
            chunks.append(chunk)
            selected.append(document)
            remaining -= len(chunk)
        rendered = "\n".join(chunks)
        selected_ids = {document.id for document in selected}
        return RAGContext(tuple(selected), rendered, tuple(document.id for document in selected), {
            "source_counts": counts,
            "available_sources": list(source_order),
            "context_characters": len(rendered),
            "truncated_ids": truncated_ids,
            "omitted_ids": list(dict.fromkeys(document.id for document in documents if document.id not in selected_ids)),
        })
