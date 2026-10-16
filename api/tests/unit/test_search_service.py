from PIL import Image
import pytest
from shopmind.app.api.errors import SearchInfrastructureError, UnsupportedSearchMode
from shopmind.app.domain.search_query import SearchMode, SearchRequest
from shopmind.app.domain.search_result import SearchResult
from shopmind.app.search.service import SearchService


class FakeRetriever:
    def __init__(self,source): self.source=source; self.calls=[]
    def search(self,request): self.calls.append(request); return [SearchResult(product_id="P1",title="Runner",rank=1,score=0.9,source=self.source,metadata={"search_text":"Runner Brand: Acme","category":"Shoes"})]
class FakeImageRetriever:
    def __init__(self): self.calls=[]
    def search_image(self,image,top_k=10,candidate_k=100,filters=None): self.calls.append((image,top_k,candidate_k,filters)); return [SearchResult("P2","Image Item",1,0.8,"image_dense",{"category":"Demo"})]
class FailingRetriever:
    def search(self,request): raise RuntimeError("backend exploded")

def _service(**overrides):
    parts={"bm25":FakeRetriever("bm25"),"dense":FakeRetriever("dense"),"hybrid":FakeRetriever("hybrid"),"cross_modal":FakeRetriever("cross_modal"),"image":FakeImageRetriever()}; parts.update(overrides); return SearchService(**parts),parts

@pytest.mark.parametrize(("mode","key"),[(SearchMode.BM25,"bm25"),(SearchMode.DENSE,"dense"),(SearchMode.HYBRID,"hybrid"),(SearchMode.CROSS_MODAL,"cross_modal")])
def test_search_service_dispatches_each_text_mode(mode,key):
    service,retrievers=_service(); request=SearchRequest("runner",mode=mode); results=service.search_text(request); assert retrievers[key].calls==[request]; assert results[0].product_id=="P1"; assert sum(len(getattr(value,"calls",[])) for name,value in retrievers.items() if name!="image")==1

def test_search_service_dispatches_image_search():
    service,retrievers=_service(); image=Image.new("RGB",(3,3)); results=service.search_image(image,top_k=2,candidate_k=7,filters={"category":"Shoes"}); assert retrievers["image"].calls==[(image,2,7,{"category":"Shoes"})]; assert results[0].product_id=="P2"

def test_search_service_rejects_unknown_mode():
    service,_=_service(); request=SearchRequest("runner",mode="unknown")
    with pytest.raises(UnsupportedSearchMode): service.search_text(request)

def test_to_retrieved_documents_maps_product_result_for_future_rag():
    service,_=_service(); results=[SearchResult(product_id="P9",title="Oak Chair",rank=1,score=0.42,source="hybrid",metadata={"search_text":"Oak Chair\nCategory: Furniture","category":"Furniture"})]; documents=service.to_retrieved_documents(results)
    assert documents[0].id=="P9"; assert documents[0].content=="Oak Chair\nCategory: Furniture"; assert documents[0].source=="product"; assert documents[0].metadata["title"]=="Oak Chair"; assert documents[0].metadata["category"]=="Furniture"

def test_search_service_wraps_backend_exceptions_without_leaking_type():
    service,_=_service(bm25=FailingRetriever())
    with pytest.raises(SearchInfrastructureError) as exc_info: service.search_text(SearchRequest("runner",mode=SearchMode.BM25))
    assert isinstance(exc_info.value.__cause__,RuntimeError); assert "backend exploded" not in str(exc_info.value)
