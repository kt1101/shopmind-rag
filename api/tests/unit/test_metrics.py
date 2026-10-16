import math
import pytest
from evaluation.metrics import mrr_at_k, ndcg_at_k, recall_at_k


def test_recall_at_k(): assert recall_at_k(["P1","P3"], {"P1":1,"P2":1}, 2) == 0.5

def test_mrr_at_k(): assert mrr_at_k(["X","P1","P2"], {"P1":1,"P2":1}, 3) == 0.5

def test_ndcg_at_k_uses_graded_relevance():
    ranked=["P2","P1","X"]; relevance={"P1":3,"P2":1}; dcg=(2**1-1)/math.log2(2)+(2**3-1)/math.log2(3); idcg=(2**3-1)/math.log2(2)+(2**1-1)/math.log2(3)
    assert ndcg_at_k(ranked,relevance,3) == pytest.approx(dcg/idcg)

def test_metrics_return_zero_without_positive_relevance():
    relevance={"P1":0}; assert recall_at_k(["P1"],relevance,10)==0.0; assert mrr_at_k(["P1"],relevance,10)==0.0; assert ndcg_at_k(["P1"],relevance,10)==0.0

def test_metrics_reject_non_positive_k():
    with pytest.raises(ValueError): recall_at_k([],{},0)

def test_duplicate_products_consume_rank_without_repeated_gain():
    assert ndcg_at_k(["P1", "P1"], {"P1": 1}, 10) == 1.0
    expected = (1 + 1 / math.log2(4)) / (1 + 1 / math.log2(3))
    assert ndcg_at_k(["P1", "P1", "P2"], {"P1": 1, "P2": 1}, 10) == pytest.approx(expected)
