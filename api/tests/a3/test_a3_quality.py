"""Synthetic adversarial fixtures: structural evidence/repair, not semantic accuracy."""
from __future__ import annotations

import json
from types import SimpleNamespace

import pytest

from shopmind.domain.search_result import RetrievedDocument
from shopmind.infrastructure.llm.base import LLMProviderError
from shopmind.infrastructure.llm.openai_provider import OpenAIProvider
from shopmind.application.rag.citations import CitationResolver
from shopmind.application.rag.context import ContextBuilder
from shopmind.application.rag.models import RAGRequest
from shopmind.application.rag.service import RAGGenerationError
from tests.a3.test_a3_service import Retriever, _service


class ScriptedProvider(OpenAIProvider):
    def __init__(self, outputs):
        self.outputs = iter(outputs)
        self.calls = []
        super().__init__(client=SimpleNamespace(responses=SimpleNamespace(create=self.create)), model="synthetic-fixture")

    def create(self, **kwargs):
        self.calls.append(kwargs)
        output = next(self.outputs)
        if isinstance(output, Exception):
            raise output
        return SimpleNamespace(output_text=output, model="synthetic-fixture", id="fixture")


def structured(answer="Blue.", ids=("product:P1",), insufficient=False):
    return json.dumps({"answer": answer, "citation_ids": list(ids), "insufficient_evidence": insufficient})


def product(product_id="P1"):
    return RetrievedDocument(f"product:{product_id}", "Blue shoes", 1, "product", {"product_id": product_id, "title": "Shoes"})


@pytest.mark.parametrize("first", [structured(" \n\t"), "not JSON", structured(ids=("product:unknown",))])
def test_invalid_generation_is_repaired_in_one_shared_loop(first):
    provider = ScriptedProvider([first, structured()])
    answer = _service({"product": Retriever("product", [product()])}, provider).answer(RAGRequest("Color?", product_id="P1", sources=("product",)))
    assert answer.answer == "Blue."
    assert [source.document_id for source in answer.sources] == ["product:P1"]
    assert answer.metadata["generation_attempts"] == 2


@pytest.mark.parametrize("outputs", [["bad", "bad"], [structured(" "), structured(" ")], ["bad", structured(ids=("product:unknown",))]])
def test_invalid_generations_exhaust_at_two_calls(outputs):
    provider = ScriptedProvider(outputs)
    with pytest.raises(RAGGenerationError):
        _service({"product": Retriever("product", [product()])}, provider).answer(RAGRequest("Color?", sources=("product",)))
    assert len(provider.calls) == 2


def test_transport_failure_is_not_retried_or_abstained():
    provider = ScriptedProvider([RuntimeError("network unavailable")])
    with pytest.raises(LLMProviderError):
        _service({"product": Retriever("product", [product()])}, provider).answer(RAGRequest("Color?", sources=("product",)))
    assert len(provider.calls) == 1


def test_review_metadata_false_zero_and_conflicts_remain_in_evidence():
    reviews = [
        RetrievedDocument("review:good", "Fits well", 1, "review", {"product_id": "P1", "rating": 5, "verified_purchase": False, "helpful_vote": 0, "timestamp": 0, "text_vector": [0.4]}),
        RetrievedDocument("review:bad", "Too tight", 1, "review", {"product_id": "P1", "rating": 1, "verified_purchase": True}),
        RetrievedDocument("review:unknown", "Unrated", 1, "review", {"product_id": "P1"}),
    ]
    context = ContextBuilder(3, {"review": 3}, 2000).build(reviews)
    evidence = [json.loads(line) for line in context.rendered_context.splitlines()]
    assert [(row["id"], row.get("rating")) for row in evidence] == [("review:good", 5), ("review:bad", 1), ("review:unknown", None)]
    assert evidence[0]["product_id"] == "P1"
    assert evidence[0]["verified_purchase"] is False
    assert evidence[0]["helpful_vote"] == evidence[0]["timestamp"] == 0
    assert "rating" not in evidence[2] and "verified_purchase" not in evidence[2]
    assert all("text_vector" not in row for row in evidence)
    resolved = CitationResolver().resolve(context.citation_ids, context.documents)
    assert resolved[0].metadata["timestamp"] == 0


def test_product_facts_are_whitelisted_without_dumping_metadata():
    document = RetrievedDocument("product:P1", "Shoes", 1, "product", {"product_id": "P1", "brand": "Acme", "category": "shoes", "color": ["blue"], "image_vector": [0.4], "private": "omit"})
    row = json.loads(ContextBuilder(1, {"product": 1}, 1000).build([document]).rendered_context)
    assert {key: row[key] for key in ("product_id", "brand", "category", "color")} == {"product_id": "P1", "brand": "Acme", "category": "shoes", "color": ["blue"]}
    assert "private" not in row and "image_vector" not in row


def test_escaped_oversized_evidence_keeps_each_source_and_marks_exact_excerpts():
    documents = [
        RetrievedDocument("product:P1", '"\\\n鞋' * 1000, 1, "product", {"product_id": "P1"}),
        RetrievedDocument("product:P2", "second product" * 500, 1, "product", {"product_id": "P2"}),
        RetrievedDocument("review:R1", "Too tight" * 500, 1, "review", {"product_id": "P1", "rating": 1, "verified_purchase": False}),
        RetrievedDocument("policy:returns", "Experimental returns" * 500, 1, "policy", {"version": "v1", "provenance": "shopmind_curated_experimental"}),
    ]
    context = ContextBuilder(3, {"product": 2, "review": 1, "policy": 1}, 1000).build(documents)
    evidence = [json.loads(line) for line in context.rendered_context.splitlines()]
    assert [row["id"] for row in evidence] == ["product:P1", "review:R1", "policy:returns"]
    assert len(context.rendered_context) <= 1000
    assert all(row["content"] and row["content_truncated"] for row in evidence)
    assert evidence[2]["provenance"] == "shopmind_curated_experimental"
    assert context.metadata["truncated_ids"] == list(context.citation_ids)
    for document, row, source in zip(context.documents, evidence, CitationResolver().resolve(context.citation_ids, context.documents)):
        assert document.content == row["content"]
        assert source.metadata["content_truncated"] is True


def test_unrepresentable_envelope_reports_omitted_source_without_invalid_json():
    context = ContextBuilder(1, {"product": 1}, 8).build([product()])
    assert context.documents == () and context.rendered_context == ""
    assert context.metadata["omitted_ids"] == ["product:P1"]


def test_wrong_product_and_unlinked_review_never_reach_llm_or_citations():
    reviews = [RetrievedDocument("review:wrong", "Wrong product fits", 1, "review", {"product_id": "P2"}), RetrievedDocument("review:unlinked", "Unknown product fits", 1, "review", {})]
    provider = ScriptedProvider([structured()])
    service = _service({"product": Retriever("product", [product("P2"), product()]), "review": Retriever("review", reviews)}, provider)
    answer = service.answer(RAGRequest("Color?", product_id="P1", sources=("product", "review")))
    evidence = provider.calls[0]["input"][1]["content"]
    assert "product:P2" not in evidence and "review:wrong" not in evidence and "review:unlinked" not in evidence
    assert answer.metadata["context_ids"] == ["product:P1"]
    assert answer.metadata["missing_sources"] == ["review"]
    assert [source.product_id for source in answer.sources] == ["P1"]


def test_catalog_attribute_color_is_evidence_without_other_attributes():
    document = RetrievedDocument("product:P1", "Shoes", 1, "product", {"product_id": "P1", "attributes": {"color": "blue", "internal": "omit"}})
    row = json.loads(ContextBuilder(1, {"product": 1}, 1000).build([document]).rendered_context)
    assert row["color"] == "blue"
    assert "attributes" not in row and "internal" not in row


def test_all_wrong_product_evidence_abstains_without_generation():
    provider = ScriptedProvider([])
    service = _service({"product": Retriever("product", [product("P2")])}, provider)
    answer = service.answer(RAGRequest("Color?", product_id="P1", sources=("product",)))
    assert answer.insufficient_evidence and answer.sources == ()
    assert answer.metadata["context_ids"] == [] and answer.metadata["generation_attempts"] == 0
    assert provider.calls == []


@pytest.mark.parametrize("large_title_length", [2000, 800])
def test_source_reservation_replaces_unusable_first_envelope_before_extra_reviews(large_title_length):
    first = RetrievedDocument("review:R1", "Fits well", 1, "review", {"product_id": "P1", "verified_purchase": False, "helpful_vote": 0})
    oversized = RetrievedDocument("policy:large", "Experimental returns", .9, "policy", {"title": "x" * large_title_length, "provenance": "shopmind_curated_experimental"})
    second = RetrievedDocument("review:R2", "Also fits well", .8, "review", {"product_id": "P1"})
    usable = RetrievedDocument("policy:small", "Experimental returns within 30 days", .7, "policy", {"provenance": "shopmind_curated_experimental"})
    if large_title_length == 800:
        assert ContextBuilder(1, {"policy": 1}, 1000).build([oversized]).citation_ids == ("policy:large",)
    context = ContextBuilder(2, {"review": 2, "policy": 1}, 1000).build([first, oversized, second, usable])
    assert context.citation_ids == ("review:R1", "policy:small")
    assert context.metadata["source_counts"] == {"review": 1, "policy": 1}
    assert context.metadata["omitted_ids"] == ["policy:large", "review:R2"]
    assert len(context.rendered_context) <= 1000
    rows = [json.loads(line) for line in context.rendered_context.splitlines()]
    assert rows[0]["verified_purchase"] is False and rows[0]["helpful_vote"] == 0
    assert rows[1]["provenance"] == "shopmind_curated_experimental"
