"""Search pipelines from configs/pipelines/search.yaml run through the traced engine (P1, A-4, F1)."""
from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
from PIL import Image

import shopmind.application.search.steps  # noqa: F401  (registers steps)
from shopmind.application.pipeline import PipelineFactory
from shopmind.application.retrieval.fusion import fuse_named_rankings
from shopmind.application.search.service import SearchService
from shopmind.application.search.steps import adaptive_search_mode
from shopmind.core.config import load_app_config
from shopmind.core.tracing import start_trace
from shopmind.domain.search_query import SearchMode, SearchRequest
from shopmind.domain.search_result import RawSearchHit, SearchResult

CONFIG = load_app_config(Path(__file__).resolve().parents[2] / "configs" / "app.yaml", profile="eval")


def hit(pid, score, **metadata):
    return RawSearchHit(pid, f"Title {pid}", score, {"brand": "Acme", "category": "SOFA", **metadata})


class FakeRepository:
    def __init__(self, lexical=None, dense=None, exact=None):
        self.lexical = lexical if lexical is not None else [hit("A", 9.0), hit("B", 7.0), hit("C", 5.0)]
        self.dense = dense if dense is not None else [hit("C", 0.9), hit("A", 0.8), hit("D", 0.7)]
        self.exact = exact or []
        self.calls = []

    def exact_id_search(self, query, filters):
        return [hit(query, 1.0)] if query in self.exact else []

    def lexical_search(self, query, size, filters, debug=None):
        self.calls.append(("lexical", query, filters, debug is not None))
        if debug is not None:
            debug["query_dsl"] = {"query": {"multi_match": {"query": query}}}
        return self.lexical[:size]

    def vector_search(self, field, vector, size, num_candidates, filters, debug=None, exclude_ids=None):
        self.calls.append(("vector", field, len(vector), exclude_ids))
        return [h for h in self.dense if h.product_id not in (exclude_ids or [])][:size]

    def describe_filters(self, filters):
        return {key: {"requested": [value], "resolved": [value], "match": "exact"} for key, value in filters.items()}


class FakeEmbedder:
    dimension = 3
    is_ready = True

    def __init__(self):
        self.queries, self.images = [], 0

    def embed_texts(self, texts):
        return np.array([[0.0, 1.0, 0.0]] * len(texts), dtype=np.float32)

    def embed_queries(self, texts):
        self.queries.extend(texts)
        return np.array([[0.0, 1.0, 0.0]] * len(texts), dtype=np.float32)

    def embed_images(self, images):
        self.images += len(images)
        return np.array([[1.0, 0.0, 0.0]] * len(images), dtype=np.float32)


class Services(dict):
    def get(self, name, default=None):  # container-like
        return super().get(name, default)


def make(repository=None, specs=None):
    repository = repository or FakeRepository()
    embedder = FakeEmbedder()
    services = Services(repository=repository, embedders={"text_e5": embedder, "siglip2": embedder}, field_embedders={"text_vector": "text_e5", "image_vector": "siglip2", "siglip_text_vector": "siglip2"})
    factory = PipelineFactory(specs or CONFIG.pipelines, services)
    return SearchService(pipelines=factory, routes=dict(CONFIG.defaults)), repository, embedder


def test_hybrid_pipeline_fuses_with_contributions_and_a_full_trace():
    service, repository, _ = make()
    with start_trace("search.hybrid", kind="search", trace_id="t", verbose=True) as trace:
        results = service.search_text(SearchRequest("ghế sofa xám", SearchMode.HYBRID, top_k=3, candidate_k=10, filters={"category": "SOFA"}))
    assert [r.product_id for r in results] == ["A", "C", "B"]  # A: 1/61+1/62, C: 1/63+1/61, B: 1/62
    assert {r.source for r in results} == {"hybrid"} and [r.rank for r in results] == [1, 2, 3]
    steps = {step.id: step for step in trace.steps}
    assert list(steps) == ["query_understanding", "lexical", "semantic", "fuse", "rerank"]
    understanding = steps["query_understanding"].details
    assert understanding["language"] == "vi" and {a["to"] for a in understanding["aliases"]} == {"sofa", "gray"}
    assert understanding["filters"]["category"]["match"] == "exact"
    assert steps["lexical"].details["query_dsl"]["query"]["multi_match"]["query"] == "ghế sofa xám"
    assert steps["semantic"].details["query_vector"] == {"dims": [3], "norm": 1.0}
    first = steps["fuse"].output["items"][0]
    assert first["details"]["contributions"] == {"lexical": {"rank": 1, "score": round(1 / 61, 6)}, "semantic": {"rank": 2, "score": round(1 / 62, 6)}}
    assert first["details"]["formula"].startswith("1/(60+1) + 1/(60+2)")


def test_explain_off_skips_costly_inspector_work():
    service, repository, _ = make()
    with start_trace("search.hybrid", kind="search", trace_id="t") as trace:
        service.search_text(SearchRequest("sofa", SearchMode.HYBRID, top_k=2, candidate_k=10, filters={"category": "SOFA"}))
    assert ("lexical", "sofa", {"category": "SOFA"}, False) in repository.calls
    assert "filters" not in trace.steps[0].details


def test_exact_product_id_short_circuits_the_pipeline():
    service, repository, _ = make(FakeRepository(exact=["B0ABC12345"]))
    with start_trace("p", kind="search", trace_id="t") as trace:
        results = service.search_text(SearchRequest("B0ABC12345", SearchMode.HYBRID, top_k=5, candidate_k=10))
    assert [r.product_id for r in results] == ["B0ABC12345"]
    assert [step.id for step in trace.steps] == ["query_understanding", "lexical"]
    assert not any(call[0] == "vector" for call in repository.calls)


@pytest.mark.parametrize("query,mode", [("B07PH3GSND", "bm25"), ("brown leather boots for winter hiking", "dense"), ("sofa", "hybrid"), ("iphone 12 case with card holder", "hybrid")])
def test_adaptive_rule_router(query, mode):
    assert adaptive_search_mode(query)[0] == mode


def test_adaptive_pipeline_runs_only_the_chosen_retriever():
    service, repository, _ = make()
    results = service.search_text(SearchRequest("brown leather boots for winter hiking", SearchMode.ADAPTIVE, top_k=2, candidate_k=10))
    assert [call[0] for call in repository.calls] == ["vector"]
    assert results[0].product_id == "C" and results[0].source == "adaptive"


def test_weighted_rrf_and_linear_fusion():
    lexical = [SearchResult("A", "a", 1, 9.0, "bm25"), SearchResult("B", "b", 2, 1.0, "bm25")]
    dense = [SearchResult("B", "b", 1, 0.9, "dense"), SearchResult("A", "a", 2, 0.1, "dense")]
    equal = fuse_named_rankings({"lexical": lexical, "semantic": dense}, k=60, top_k=2)
    assert equal[0].score == pytest.approx(equal[1].score)
    weighted = fuse_named_rankings({"lexical": lexical, "semantic": dense}, k=60, weights=[1.0, 0.5], top_k=2)
    assert [r.product_id for r in weighted] == ["A", "B"] and weighted[0].metadata["formula"].startswith("1/(60+1) + 0.5/(60+2)")
    linear = fuse_named_rankings({"lexical": lexical, "semantic": dense}, method="linear", weights={"lexical": 0.2, "semantic": 0.8}, top_k=2)
    assert [r.product_id for r in linear] == ["B", "A"] and linear[0].score == pytest.approx(0.8)
    assert linear[0].retrieval_scores.bm25_rank == 2 and linear[0].retrieval_scores.dense_rank == 1


def test_compose_pipeline_mixes_image_and_text_and_boosts_named_colour():
    repository = FakeRepository(dense=[hit("A", 0.9, attributes={"color": "Red"}), hit("B", 0.88, attributes={"color": "Nero"}), hit("C", 0.5)])
    service, repository, embedder = make(repository)
    image = Image.new("RGB", (4, 4))
    with start_trace("search.compose", kind="compose_search", trace_id="t") as trace:
        results = service.search_compose(image, "màu đen", alpha=0.5, top_k=3, candidate_k=10)
    assert [r.product_id for r in results] == ["B", "A", "C"]  # Nero == black gets the boost
    assert results[0].metadata["boosted"] == ["color"]
    compose = trace.steps[0]
    assert compose.details["alpha"] == 0.5 and compose.summary.startswith("q = normalize(0.50·image + 0.50·text)")
    assert embedder.queries == ["màu đen"] and embedder.images == 1
    assert repository.calls[0][:2] == ("vector", "image_vector")


def test_image_and_similar_pipelines():
    service, repository, embedder = make()
    results = service.search_image(Image.new("RGB", (4, 4)), top_k=2, candidate_k=10)
    assert [r.source for r in results] == ["image_dense", "image_dense"]
    similar = service.similar("C", [1.0, 0.0, 0.0], limit=2)
    assert "C" not in [r.product_id for r in similar] and repository.calls[-1][3] == ["C"]


def test_every_configured_pipeline_resolves_its_steps():
    service, *_ = make()
    for name in CONFIG.pipelines:
        if name.startswith("search."):
            assert service.pipelines.get(name).steps, name
