"""F2 assistant routing, F3 compare, chat image tokens, prompts and the embedding map."""
from __future__ import annotations

import json

import numpy as np
import pytest
from fastapi.testclient import TestClient

from scripts.build_embedding_map import build_space, pca_2d
from shopmind.application.chat.image_cache import ImageTokenCache
from shopmind.application.chat.intents import RuleQueryUnderstanding, route_intent
from shopmind.application.chat.service import ChatService
from shopmind.application.rag.compare import CompareService, attribute_table
from shopmind.application.rag.context import ContextBuilder
from shopmind.core.config import ChatConfig
from shopmind.domain.search_result import SearchResult
from shopmind.infrastructure.llm.base import LLMProviderError
from shopmind.infrastructure.llm.prompts import PromptLibrary, default_prompts
from shopmind.interfaces.http.errors import InvalidImage
from shopmind.main import create_app


@pytest.mark.parametrize("message,kwargs,intent", [
    ("xin chào", {}, "chitchat"),
    ("so sánh hai đôi giày này", {}, "compare"),
    ("chính sách đổi trả thế nào?", {}, "policy_question"),
    ("tìm sofa xám dưới 500 đô", {}, "product_search"),
    ("Cái này có chống nước không?", {"product_id": "P1"}, "product_question"),
    ("giống cái này", {"has_image": True}, "product_search"),
    ("black leather boots", {}, "product_search"),
])
def test_route_intent(message, kwargs, intent):
    assert route_intent(message, **kwargs)[0] == intent


def test_rule_understanding_only_uses_catalog_values():
    catalog = {"brand": ["Rivet", "Stone & Beam"], "category": ["SOFA", "SHOES"]}
    understood = RuleQueryUnderstanding(lambda field: catalog[field]).understand("tìm ghế sofa xám của Rivet dưới 500 đô")
    assert understood.intent == "product_search"
    assert understood.filters == {"category": ["SOFA"], "color": ["gray"], "brand": ["Rivet"]}
    assert understood.price == {"max": 500.0}
    assert "Rivet" not in understood.rewritten_query and "500" not in understood.rewritten_query
    assert {span["filter"] for span in understood.spans} == {"category", "color", "brand"}


class FakeSearch:
    def __init__(self, results):
        self.results = results
        self.calls = []

    def search_text(self, request):
        self.calls.append(("text", request.query, dict(request.filters)))
        return [] if request.filters.get("brand") == ["Nobody"] else self.results

    def search_image(self, image, **kwargs):
        self.calls.append(("image",))
        return self.results

    def search_compose(self, image, text, **kwargs):
        self.calls.append(("compose", text))
        return self.results


class NoLLMRag:
    llm = None

    def prepare(self, request):  # pragma: no cover - must not be reached for direct intents
        raise AssertionError("RAG must not run for product search")


class Store:
    def __init__(self):
        self.messages = {}

    def append(self, session_id, role, content, extra=None):
        self.messages.setdefault(session_id, []).append({"role": role, "content": content, **(extra or {})})

    def get(self, session_id):
        return self.messages.get(session_id, [])


RESULTS = [SearchResult("P1", "Grey Sofa", 1, 0.9, "hybrid", {"brand": "Rivet", "image_url": "/media/products/P1.jpg"}), SearchResult("P2", "Blue Sofa", 2, 0.8, "hybrid", {})]


def make_chat(**kwargs):
    store = Store()
    search = FakeSearch(RESULTS)
    service = ChatService(NoLLMRag(), ChatConfig(), lambda: False, lambda pid: None, understanding=RuleQueryUnderstanding(lambda field: {"brand": ["Rivet", "Nobody"], "category": ["SOFA"]}[field]), search=search, image_cache=ImageTokenCache(), store=store, **kwargs)
    return service, search, store


def test_product_search_is_answered_with_cards_without_an_llm():
    service, search, store = make_chat()
    prepared = service.prepare("tìm sofa màu xám", [], None)
    answer = service.answer(prepared)
    assert prepared.intent == "product_search" and [p.product_id for p in prepared.products] == ["P1", "P2"]
    assert answer.answer.splitlines()[1] == "1. Grey Sofa (Rivet)" and "gray" in answer.answer
    assert search.calls[0][0] == "text" and search.calls[0][2]["color"] == ["gray"]
    assert [m["role"] for m in store.get(prepared.session_id)] == ["user", "assistant"]


def test_filters_are_relaxed_when_nothing_matches():
    service, search, _ = make_chat()
    prepared = service.prepare("tìm sofa của Nobody", [], None)
    assert prepared.products and "nới" in prepared.direct_answer.answer
    assert search.calls[-1][2] == {}


def test_image_token_routes_to_compose_or_image_search():
    service, search, _ = make_chat()
    token = service.image_cache.put(object())
    service.prepare("tìm cái giống ảnh này nhưng màu đen", [], None, image_token=token)
    service.prepare("giống ảnh này", [], None, image_token=token)
    assert [call[0] for call in search.calls] == ["compose", "image"]
    with pytest.raises(InvalidImage):
        service.prepare("giống ảnh này", [], None, image_token="expired")


def test_questions_still_require_an_llm_and_chitchat_does_not():
    service, _, _ = make_chat()
    assert service.prepare("xin chào", [], None).direct_answer.answer.startswith("Chào bạn")
    with pytest.raises(LLMProviderError):
        service.prepare("chính sách đổi trả thế nào?", [], None)


def test_image_cache_expires_and_is_bounded():
    now = [0.0]
    cache = ImageTokenCache(ttl_seconds=10, capacity=2, clock=lambda: now[0])
    first, second, third = cache.put("a"), cache.put("b"), cache.put("c")
    assert cache.get(first) is None and cache.get(second) == "b"
    now[0] = 11
    assert cache.get(third) is None


class Catalog:
    def __init__(self):
        self.products = {
            "P1": {"product_id": "P1", "title": "Grey Sofa", "brand": "Rivet", "category": "SOFA", "category_label": "Sofa", "attributes": {"color": "Grey", "material": "Linen", "product_type": "SOFA"}, "bullet_points": [], "description": "Comfy", "image_url": None},
            "P2": {"product_id": "P2", "title": "Blue Sofa", "brand": None, "category": "SOFA", "category_label": "Sofa", "attributes": {"color": "Blue"}, "bullet_points": [], "description": "", "image_url": None, "price": {"amount": 300, "currency": "USD", "synthetic": True}},
        }

    def get_product(self, product_id):
        return self.products[product_id]


class StructuredLLM:
    model = "fake"
    provider_name = "fake"

    def __init__(self, outputs):
        self.outputs = list(outputs)
        self.instructions = []

    def generate_structured(self, instructions, user, schema, name):
        self.instructions.append(instructions)
        return self.outputs.pop(0)


class FakeRag:
    def __init__(self, llm):
        self.llm = llm
        self.context_builder = ContextBuilder(12, {"product": 4, "review": 5, "policy": 3}, 24000)
        self.multi_source = type("MS", (), {"retrievers": {}})()


def test_attribute_table_marks_missing_values_and_synthetic_price():
    table = {row["name"]: row["values"] for row in attribute_table(list(Catalog().products.values()))}
    assert table["material"] == {"P1": "Linen", "P2": None}
    assert table["price"]["P1"] is None and "synthetic" in table["price"]["P2"]
    assert "product_type" not in table


def test_compare_validates_citations_and_retries_once():
    bad = {"summary": "s", "points": [{"text": "x", "citation_ids": ["review:nope"]}], "insufficient_evidence": False}
    good = {"summary": "P1 is linen", "points": [{"text": "P1 is linen, P2 has no material data", "citation_ids": ["product:P1", "product:P2"]}], "insufficient_evidence": False}
    llm = StructuredLLM([bad, good])
    result = CompareService(Catalog(), FakeRag(llm), default_prompts()).compare(["P1", "P2"])
    assert result["points"][0]["citation_ids"] == ["product:P1", "product:P2"]
    assert [source["citation_id"] for source in result["sources"]] == ["product:P1", "product:P2"]
    assert "rejected" in llm.instructions[1]


def test_compare_without_llm_returns_the_table_only():
    result = CompareService(Catalog(), FakeRag(None), default_prompts()).compare(["P1", "P2"])
    assert result["llm_available"] is False and result["attributes"] and result["points"] == []


def test_prompts_are_versioned_files():
    prompt = default_prompts().get("answer")
    assert prompt.version == "v1" and "Answer only from supplied evidence" in prompt.text
    with pytest.raises(KeyError):
        PromptLibrary().get("missing")


def test_embedding_map_build_and_project(tmp_path, monkeypatch):
    rng = np.random.default_rng(0)
    matrix = rng.normal(size=(20, 3)).astype(np.float32)
    coords, mean, components, ratio = pca_2d(matrix)
    assert coords.shape == (20, 2) and components.shape == (2, 3) and ratio[0] >= ratio[1]
    payload = build_space("text", [f"P{i}" for i in range(20)], matrix, {"P0": {"category": "SOFA", "title": "Sofa"}}, embedder="text_e5", model="m")
    (tmp_path / "text.json").write_text(json.dumps(payload), encoding="utf-8")
    monkeypatch.chdir(tmp_path)
    (tmp_path / "data").mkdir()
    (tmp_path / "data" / "embedding_map").mkdir()
    (tmp_path / "data" / "embedding_map" / "text.json").write_text(json.dumps(payload), encoding="utf-8")

    class Embedder:
        def embed_queries(self, texts):
            return matrix[:1]

    app = create_app(auto_wire=False, components={"embedders": {"text_e5": Embedder()}, "field_embedders": {"text_vector": "text_e5"}})
    with TestClient(app) as client:
        points = client.get("/api/v1/meta/embedding-map?space=text").json()["points"]
        assert len(points) == 20 and points[0]["category"] == "SOFA"
        projected = client.post("/api/v1/meta/embedding-map/project", json={"space": "text", "query": "sofa"}).json()
        assert projected["x"] == pytest.approx(points[0]["x"], abs=1e-4)
        assert client.get("/api/v1/meta/embedding-map?space=image").json()["error"]["code"] == "embedding_map_not_built"
