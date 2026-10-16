from shopmind.app.domain.search_result import RetrievalScores, SearchResult
from shopmind.app.retrieval.fusion import rrf_fuse


def r(pid,rank,source,metadata=None):
    scores=RetrievalScores(bm25_rank=rank if source=="bm25" else None,dense_rank=rank if source=="dense" else None); return SearchResult(pid,pid,rank,1.0,source,metadata or {},scores)

def test_rrf_combines_rankings_deterministically():
    bm25=[r("A",1,"bm25"),r("B",2,"bm25"),r("C",3,"bm25")]; dense=[r("B",1,"dense"),r("D",2,"dense"),r("A",3,"dense")]; fused=rrf_fuse([bm25,dense],k=60,top_k=4)
    assert [x.product_id for x in fused[:2]]==["B","A"]; assert fused[0].retrieval_scores.rrf_score is not None; assert fused[0].retrieval_scores.bm25_rank==2; assert fused[0].retrieval_scores.dense_rank==1; assert [result.rank for result in fused]==[1,2,3,4]; assert all(result.source=="hybrid" for result in fused)

def test_rrf_uses_product_id_as_tie_breaker_and_merges_metadata_first_value_wins():
    one=[r("B",1,"bm25",{"category":"Shoes","brand":"First"})]; two=[r("A",1,"dense",{"category":"Furniture"}),r("B",2,"dense",{"brand":"Second","color":"black"})]; fused=rrf_fuse([one,two],k=60,top_k=3); b=next(result for result in fused if result.product_id=="B"); assert b.metadata=={"category":"Shoes","brand":"First","color":"black"}

def test_rrf_deterministic_tie_breaker_for_equal_scores():
    fused=rrf_fuse([[r("B",1,"bm25")],[r("A",1,"dense")]],k=60,top_k=2); assert [result.product_id for result in fused]==["A","B"]
