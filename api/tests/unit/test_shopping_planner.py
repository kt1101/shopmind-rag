"""F6 shopping planner: budget parsing, exact budget optimization, decomposition, cited reasons."""
from __future__ import annotations

import itertools

import pytest
from fastapi.testclient import TestClient

from shopmind.application.chat.intents import route_intent
from shopmind.application.rag.context import ContextBuilder
from shopmind.application.rag.planner import PlanRequestError, ShoppingPlanner, optimize_budget, parse_budget
from shopmind.core.tracing import start_trace
from shopmind.domain.search_result import RetrievedDocument, SearchResult
from shopmind.infrastructure.llm.prompts import default_prompts
from shopmind.main import create_app


@pytest.mark.parametrize("text,budget", [
    ("Mình mới chuyển vào căn hộ studio, ngân sách 800 đô", 800.0),
    ("Chuẩn bị đi biển, dưới 300 đô", 300.0),
    ("I need a backpack and shoes, budget $200", 200.0),
    ("quà khoảng 150$", 150.0),
    ("set up a home office for 1,200 dollars", 1200.0),
    ("đồ cho chó con", None),
])
def test_parse_budget(text, budget):
    assert parse_budget(text) == budget


def _brute_force(options, budget):
    best_utility = -1.0
    for combo in itertools.product(*[[None, *range(len(opts))] for opts in options]):
        cost = sum((options[i][j][0] or 0) for i, j in enumerate(combo) if j is not None)
        utility = sum(options[i][j][1] for i, j in enumerate(combo) if j is not None)
        if cost <= budget and utility > best_utility + 1e-9:
            best_utility = utility
    return best_utility


@pytest.mark.parametrize("budget", [0, 30, 75, 120, 400])
def test_optimize_budget_is_exact(budget):
    options = [[(49.99, 10.0), (19.99, 8.0)], [(99.99, 10.0), (59.99, 9.0)], [(29.99, 3.0)], [(15.0, 3.0), (5.0, 2.5)]]
    selected = optimize_budget(options, budget)
    cost = sum(options[i][j][0] for i, j in enumerate(selected) if j is not None)
    utility = sum(options[i][j][1] for i, j in enumerate(selected) if j is not None)
    assert cost <= budget + 1e-9
    assert utility == pytest.approx(_brute_force(options, budget))


def test_optimize_without_budget_takes_the_best_option_per_need():
    assert optimize_budget([[(10, 1.0), (500, 3.0)], []], None) == [1, None]


CATALOG = {
    "sofa couch": [("S1", "Grey Linen Sofa", "SOFA", 0.9), ("S2", "Leather Sofa", "SOFA", 0.7)],
    "table": [("T1", "Oak Coffee Table", "TABLE", 0.8)],
    "lamp": [("L1", "Brass Desk Lamp", "LAMP", 0.8)],
    "bed sheet set": [("B1", "Cotton Sheet Set", "FLAT_SHEET", 0.8)],
    "area rug": [("R1", "Wool Rug", "RUG", 0.8)],
    "wall art print": [("W1", "Leaf Print", "WALL_ART", 0.8)],
}
PRICES = {"S1": 600.0, "S2": 300.0, "T1": 90.0, "L1": 40.0, "B1": 60.0, "R1": 150.0, "W1": 30.0}


class FakeSearch:
    def __init__(self):
        self.requests = []

    def search_text(self, request):
        self.requests.append(request)
        key = next((k for k in CATALOG if request.query.startswith(k)), None)
        rows = CATALOG.get(key, [(f"X{len(self.requests)}", request.query.title(), "MISC", 0.5)])
        return [SearchResult(pid, title, rank, score, "hybrid", {"brand": "Acme", "category": cat, "search_text": f"{title}\nmaterial: linen", "attributes": {"material": "Linen"} if pid == "S1" else {}}) for rank, (pid, title, cat, score) in enumerate(rows, start=1)]


class Commerce:
    def get_many(self, ids):
        return {pid: {"price": {"amount": PRICES.get(pid, 20.0), "currency": "USD", "synthetic": True}, "stock": {"in_stock": pid != "S2", "quantity": 3, "synthetic": True}} for pid in ids}


class PolicyRetriever:
    def retrieve(self, query, top_k, product_id=None):
        return [RetrievedDocument("policy:returns.window", "Returns are accepted within 30 days. Bulky items need a pickup.", 1.0, "policy", {"title": "Returns"})]


class StructuredLLM:
    provider_name = "fake"
    model = "fake-model"

    def __init__(self, outputs):
        self.outputs = list(outputs)
        self.calls = []

    def generate_structured(self, instructions, user, schema, name):
        self.calls.append(name)
        return self.outputs.pop(0)


class Rag:
    def __init__(self, llm=None):
        self.llm = llm
        self.context_builder = ContextBuilder(12, {"product": 4, "policy": 3}, 24000)
        self.multi_source = type("MS", (), {"retrievers": {"policy": PolicyRetriever()}})()


def planner(llm=None):
    return ShoppingPlanner(FakeSearch(), Rag(llm), default_prompts(), commerce=Commerce(), catalog_values=lambda field: ["SOFA", "TABLE", "LAMP", "FLAT_SHEET", "RUG", "WALL_ART"])


def test_rules_plan_fills_must_haves_within_budget_and_cites_evidence():
    with start_trace("rag.plan", kind="plan", trace_id="t") as trace:
        plan = planner().plan("Mình mới chuyển vào căn hộ studio, ngân sách 800 đô")
    assert plan["method"] == "rules" and plan["occasion"]["id"] == "new_apartment" and plan["budget"] == 800.0
    needs = {need["label"]: need for need in plan["needs"]}
    assert needs["Ghế sofa"]["chosen"]["product_id"] == "S1"  # S2 is out of stock
    assert plan["total"] <= 800 and plan["within_budget"]
    assert {need["status"] for need in plan["needs"] if need["priority"] == "must"} == {"chosen"}
    assert needs["Thảm"]["status"] == "skipped_budget" and needs["Thảm"]["alternatives"]
    assert needs["Ghế sofa"]["citation_ids"] == ["product:S1"] and "material: Linen" in needs["Ghế sofa"]["reason"]
    assert plan["tips"][0]["citation_ids"] == ["policy:returns.window"]
    assert {source["citation_id"] for source in plan["sources"]} >= {"product:S1", "policy:returns.window"}
    assert [step.id or step.step for step in trace.steps][:2] == ["decompose", "n1"] and "optimize_budget" in [step.step for step in trace.steps]


def test_explicit_item_lists_beat_occasion_templates():
    plan = planner().plan("I need a black backpack, a water bottle and running shoes, budget $200")
    assert [need["query"] for need in plan["needs"]] == ["black backpack", "water bottle", "running shoes"]


def test_situation_parts_are_not_items():
    plan = planner().plan("Chuẩn bị đi biển 5 ngày cho 2 người, dưới 300 đô")
    assert plan["occasion"]["id"] == "trip" and len(plan["needs"]) >= 3


def test_llm_plan_validates_citations_and_falls_back_to_extractive_reasons():
    decomposition = {"occasion": "Studio", "budget": None, "needs": [{"label": "Sofa", "query": "sofa couch", "categories": ["SOFA", "NOT_A_CATEGORY"], "priority": "must"}, {"label": "Lamp", "query": "lamp", "categories": ["LAMP"], "priority": "nice"}]}
    bad = {"summary": "s", "items": [{"need_id": "n1", "reason": "great", "citation_ids": ["product:INVENTED"]}], "tips": [], "insufficient_evidence": False}
    llm = StructuredLLM([decomposition, bad, bad])
    plan = planner(llm).plan("cozy studio, budget 700")
    assert plan["method"] == "llm" and plan["needs"][0]["categories"] == ["SOFA"]
    assert llm.calls == ["plan_decompose_v1", "plan_justify_v1", "plan_justify_v1"]
    assert plan["needs"][0]["citation_ids"] == ["product:S1"]  # extractive fallback, not the invented id
    assert any(note.startswith("llm_justification_failed") for note in plan["notes"])


def test_llm_justification_is_used_when_valid():
    decomposition = {"occasion": "Studio", "budget": 700, "needs": [{"label": "Sofa", "query": "sofa couch", "categories": ["SOFA"], "priority": "must"}]}
    good = {"summary": "A linen sofa within budget.", "items": [{"need_id": "n1", "reason": "Linen upholstery.", "citation_ids": ["product:S1"]}], "tips": [{"text": "30-day returns.", "citation_ids": ["policy:returns.window"]}], "insufficient_evidence": False}
    plan = planner(StructuredLLM([decomposition, good])).plan("cozy studio")
    assert plan["budget"] == 700 and plan["summary"] == "A linen sofa within budget." and plan["needs"][0]["reason"] == "Linen upholstery."


def test_plan_rejects_empty_requests():
    with pytest.raises(PlanRequestError):
        planner().plan("  ")


@pytest.mark.parametrize("message,intent", [
    ("Mình mới chuyển nhà, cần mua vài thứ, ngân sách 800 đô", "shopping_plan"),
    ("chuẩn bị đi biển 5 ngày", "shopping_plan"),
    ("tìm sofa xám dưới 500 đô", "product_search"),
])
def test_chat_routes_situations_to_the_planner(message, intent):
    assert route_intent(message)[0] == intent


def test_plan_endpoint_returns_contract_shape_and_trace():
    app = create_app(auto_wire=False, components={"planner": planner()})
    with TestClient(app) as client:
        body = client.post("/api/v1/rag/plan", json={"request": "Mình mới chuyển vào căn hộ studio, ngân sách 800 đô", "explain": True}).json()
        assert body["needs"][0]["chosen"]["price"]["synthetic"] is True
        assert body["trace"]["pipeline"] == "rag.plan" and body["trace_id"]
        assert client.post("/api/v1/rag/plan", json={"request": "ab"}).status_code == 422
