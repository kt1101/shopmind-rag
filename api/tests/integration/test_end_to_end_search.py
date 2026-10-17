from shopmind.infrastructure.embedding.validation import index_embedding_metadata

import os
import uuid
import numpy as np
import pytest
from PIL import Image
from shopmind.domain.search_query import SearchMode, SearchRequest
from shopmind.infrastructure.elasticsearch.index import create_versioned_index, switch_alias
from shopmind.infrastructure.elasticsearch.repository import ElasticsearchProductRepository
from shopmind.application.retrieval.bm25 import BM25Retriever
from shopmind.application.retrieval.dense import CrossModalRetriever, ImageDenseRetriever, TextDenseRetriever
from shopmind.application.retrieval.hybrid import HybridRetriever
from shopmind.application.retrieval.reranker import NoOpReranker
from shopmind.application.search.service import SearchService

pytestmark = pytest.mark.integration


class Fake4DEmbedder:
    text_preprocessing={"fixture":1}; image_preprocessing={"fixture":1}
    model_name="fake-4d"; model_revision="test"; dimension=4; is_ready=True
    def embed_texts(self,texts):
        rows=[]
        for text in texts:
            lowered=text.lower()
            if "chair" in lowered: row=[0,1,0,0]
            elif "lamp" in lowered: row=[0,0,1,0]
            else: row=[1,0,0,0]
            rows.append(row)
        return np.asarray(rows,dtype=np.float32)
    def embed_images(self,images): return np.asarray([[0,1,0,0] for _ in images],dtype=np.float32)


def _client_or_skip():
    try: from elasticsearch import Elasticsearch
    except ImportError: pytest.skip("elasticsearch Python package is not installed")
    url=os.getenv("ELASTICSEARCH_URL","http://localhost:9200"); client=Elasticsearch(url)
    try:
        if not client.ping(): pytest.skip(f"Elasticsearch is not reachable at {url}")
    except Exception as exc: pytest.skip(f"Elasticsearch is not reachable: {exc}")
    return client


def _documents():
    base={"brand":"Acme","attributes":{},"attributes_text":"","image_url":None,"embedding_model":"fake-4d","embedding_version":"test","metadata":{}}
    return [{**base,"product_id":"P1","title":"Black Running Shoe","description":"lightweight runner","category":"Shoes","search_text":"Black Running Shoe lightweight runner","text_vector":[1,0,0,0],"image_vector":[1,0,0,0]},{**base,"product_id":"P2","title":"Oak Chair","description":"wood dining chair","category":"Furniture","search_text":"Oak Chair wood dining chair","text_vector":[0,1,0,0],"image_vector":[0,1,0,0]},{**base,"product_id":"P3","title":"Desk Lamp","description":"warm light","category":"Lighting","search_text":"Desk Lamp warm light","text_vector":[0,0,1,0],"image_vector":[0,0,1,0]}]


def test_end_to_end_all_retrieval_modes_and_image_search():
    client=_client_or_skip(); index_name=f"test_e2e_products_{uuid.uuid4().hex}"; alias=f"test_e2e_alias_{uuid.uuid4().hex}"
    try:
        create_versioned_index(client,index_name,4,embedding_metadata=index_embedding_metadata(Fake4DEmbedder(),image=True)); direct_repo=ElasticsearchProductRepository(client,index_name); success,errors=direct_repo.bulk_index(index_name,_documents()); assert success==3 and errors==[]; client.indices.refresh(index=index_name); switch_alias(client,alias=alias,target=index_name)
        repository=ElasticsearchProductRepository(client,alias); embedder=Fake4DEmbedder(); bm25=BM25Retriever(repository); dense=TextDenseRetriever(repository,embedder); cross_modal=CrossModalRetriever(repository,embedder); hybrid=HybridRetriever(bm25,dense,NoOpReranker(),rrf_k=60); image=ImageDenseRetriever(repository,embedder); service=SearchService(bm25=bm25,dense=dense,hybrid=hybrid,cross_modal=cross_modal,image=image)
        for mode in (SearchMode.BM25,SearchMode.DENSE,SearchMode.CROSS_MODAL,SearchMode.HYBRID):
            results=service.search_text(SearchRequest("black running shoe",mode=mode,top_k=2,candidate_k=3)); assert results; assert "P1" in {result.product_id for result in results}
        image_results=service.search_image(Image.new("RGB",(4,4),"black"),top_k=1,candidate_k=3); assert image_results[0].product_id=="P2"
    finally:
        try: client.indices.delete(index=index_name,ignore_unavailable=True)
        except Exception: pass
