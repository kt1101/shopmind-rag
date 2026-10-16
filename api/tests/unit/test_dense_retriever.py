import numpy as np
import pytest
from PIL import Image
from shopmind.domain.search_query import SearchMode, SearchRequest
from shopmind.domain.search_result import RawSearchHit
from shopmind.application.retrieval.dense import CrossModalRetriever, ImageDenseRetriever, TextDenseRetriever


class FakeEmbedder:
    dimension = 4
    model_name = "fake"
    model_revision = "test"
    is_ready = True
    def __init__(self): self.text_calls = []; self.image_calls = []
    def embed_texts(self, texts): self.text_calls.append(list(texts)); return np.array([[1,0,0,0] for _ in texts], dtype=np.float32)
    def embed_images(self, images): self.image_calls.append(list(images)); return np.array([[0,1,0,0] for _ in images], dtype=np.float32)


class FakeRepo:
    def __init__(self): self.calls = []
    def vector_search(self, field, vector, size, num_candidates, filters):
        self.calls.append((field, vector, size, num_candidates, filters)); return [RawSearchHit("P1", "Item", 0.9, {"category": "Demo"})]


def test_text_dense_searches_text_vector():
    repo = FakeRepo(); embedder = FakeEmbedder(); results = TextDenseRetriever(repo, embedder).search(SearchRequest("item", mode=SearchMode.DENSE))
    assert repo.calls[0][0] == "text_vector"; assert embedder.text_calls == [["item"]]; assert results[0].source == "dense"; assert results[0].retrieval_scores.dense_rank == 1


def test_cross_modal_searches_image_vector_with_text_embedding():
    repo = FakeRepo(); embedder = FakeEmbedder(); results = CrossModalRetriever(repo, embedder).search(SearchRequest("wooden chair", mode=SearchMode.CROSS_MODAL, top_k=1, candidate_k=4))
    assert repo.calls[0][0] == "image_vector"; assert repo.calls[0][2:4] == (4,4); assert results[0].source == "cross_modal"


def test_image_dense_targets_image_vector_forwards_filters_and_ranks():
    repo = FakeRepo(); embedder = FakeEmbedder(); image = Image.new("RGB", (4,4), "black"); filters = {"category":"Shoes"}
    results = ImageDenseRetriever(repo, embedder).search_image(image, top_k=1, candidate_k=5, filters=filters)
    field, vector, size, num_candidates, forwarded_filters = repo.calls[0]
    assert field == "image_vector"; assert vector == [0.0,1.0,0.0,0.0]; assert (size,num_candidates,forwarded_filters) == (5,5,filters); assert results[0].rank == 1; assert results[0].source == "image_dense"


def test_image_dense_rejects_candidate_k_smaller_than_top_k():
    with pytest.raises(ValueError, match="candidate_k"):
        ImageDenseRetriever(FakeRepo(), FakeEmbedder()).search_image(Image.new("RGB", (1,1)), top_k=10, candidate_k=3)


def test_dense_retrievers_return_only_top_k_even_if_repo_returns_more():
    class ManyRepo(FakeRepo):
        def vector_search(self, field, vector, size, num_candidates, filters):
            self.calls.append((field,vector,size,num_candidates,filters)); return [RawSearchHit(f"P{i}", f"Item {i}", 1.0-i/100, {}) for i in range(12)]
    repo = ManyRepo(); results = TextDenseRetriever(repo, FakeEmbedder()).search(SearchRequest("item", top_k=2, candidate_k=7))
    assert len(results) == 2; assert repo.calls[0][2:4] == (7,7)


@pytest.mark.parametrize("wrong_modality", ["text", "image", None])
def test_cross_modal_checks_both_identities_before_encoding_and_pins_alias(wrong_modality):
    from types import SimpleNamespace
    from shopmind.infrastructure.embedding.validation import index_embedding_metadata
    from shopmind.infrastructure.elasticsearch.repository import ElasticsearchProductRepository
    provider=FakeEmbedder()
    provider.text_preprocessing={"padding":"max_length"}
    provider.image_preprocessing={"size":224}
    mapping={"mappings":{"properties":{"text_vector":{"dims":4},"image_vector":{"dims":4}},"_meta":index_embedding_metadata(provider,image=True)}}
    if wrong_modality:
        setattr(provider,f"{wrong_modality}_preprocessing",{"wrong":True})
    class Client:
        def __init__(self):
            self.calls=[];self.mapping_calls=[];self.alias_target="physical_a"
            self.indices=SimpleNamespace(get_mapping=self.get_mapping)
        def get_mapping(self,*,index):
            self.mapping_calls.append(index)
            target=self.alias_target if index=="alias" else index
            self.alias_target="physical_b"
            return {target:mapping if target=="physical_a" else {"mappings":{}}}
        def search(self,**kwargs):
            self.calls.append(kwargs)
            return {"hits":{"hits":[{"_source":{"product_id":"P1","title":"Item"},"_score":.8}]}}
    client=Client();repository=ElasticsearchProductRepository(client,"alias")
    retriever=CrossModalRetriever(repository,provider)
    if wrong_modality:
        with pytest.raises(ValueError,match="incompatible embedding identity"):
            retriever.search(SearchRequest("shoe"))
        assert provider.text_calls==[] and client.calls==[]
    else:
        assert retriever.search(SearchRequest("shoe"))[0].product_id=="P1"
        assert client.mapping_calls[:2]==["alias","physical_a"]
        assert repository.index_alias==client.calls[0]["index"]=="physical_a"
        assert provider.text_calls==[["shoe"]]
