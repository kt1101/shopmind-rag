import numpy as np
from shopmind.app.embedding.base import EmbeddingProvider


class FakeEmbeddingProvider:
    model_name = "fake"; model_revision = "test"; dimension = 4; is_ready = True
    def embed_texts(self, texts): return np.ones((len(texts), 4), dtype=np.float32)
    def embed_images(self, images): return np.ones((len(images), 4), dtype=np.float32)


def test_fake_provider_satisfies_protocol():
    provider: EmbeddingProvider = FakeEmbeddingProvider(); result = provider.embed_texts(["x"])
    assert result.shape == (1,4)
    assert result.dtype == np.float32


import pytest
from shopmind.app.retrieval.dense import _single_vector
@pytest.mark.parametrize("matrix", [np.zeros((1,4),dtype=np.float32),np.full((1,4),np.nan,dtype=np.float32),np.full((1,4),np.inf,dtype=np.float32),np.ones((2,4),dtype=np.float32)])
def test_query_vectors_reject_invalid_values(matrix):
    with pytest.raises(ValueError): _single_vector(matrix,4,kind="text")
