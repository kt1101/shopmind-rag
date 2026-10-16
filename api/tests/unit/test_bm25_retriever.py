from shopmind.app.domain.search_query import SearchMode, SearchRequest
from shopmind.app.domain.search_result import RawSearchHit
from shopmind.app.retrieval.bm25 import BM25Retriever


class FakeRepo:
    def __init__(self, hits=None):
        self.hits = hits if hits is not None else [RawSearchHit("P2", "Runner", 8.4, {"category": "Shoes"})]
        self.calls = []
    def lexical_search(self, query, size, filters):
        self.calls.append((query, size, filters))
        return self.hits


def test_bm25_maps_hits_to_ranked_results():
    repo = FakeRepo()
    results = BM25Retriever(repo).search(SearchRequest("runner", mode=SearchMode.BM25))
    assert results[0].product_id == "P2"
    assert results[0].rank == 1
    assert results[0].source == "bm25"
    assert results[0].score == 8.4
    assert results[0].retrieval_scores.bm25_rank == 1
    assert results[0].metadata["category"] == "Shoes"


def test_bm25_uses_candidate_k_but_returns_top_k_only():
    repo = FakeRepo([RawSearchHit(f"P{i}", f"Item {i}", float(100 - i), {}) for i in range(20)])
    request = SearchRequest("item", mode=SearchMode.BM25, top_k=3, candidate_k=12)
    results = BM25Retriever(repo).search(request)
    assert len(results) == 3
    assert repo.calls == [("item", 12, {})]
    assert [result.rank for result in results] == [1, 2, 3]


def test_bm25_empty_hits_become_empty_results_and_filters_forward_unchanged():
    repo = FakeRepo([])
    filters = {"brand": "Acme", "category": ["Shoes", "Boots"]}
    request = SearchRequest("runner", mode=SearchMode.BM25, filters=filters)
    assert BM25Retriever(repo).search(request) == []
    assert repo.calls[0][2] == filters


def test_lexical_normalization_translates_catalog_terms_without_changing_ids():
    from shopmind.app.retrieval.language import normalize_lexical_query, catalog_color_terms
    assert "pillow" in normalize_lexical_query("Tìm gối màu xám của Ravenna Home.")
    assert "gray" in normalize_lexical_query("Tìm gối màu xám của Ravenna Home.")
    assert normalize_lexical_query("b07ABC1234")=="b07ABC1234"
    assert catalog_color_terms("Noir")=="black"
    assert catalog_color_terms("Black/white stripes")==""
