import os
from types import SimpleNamespace
import numpy as np
import pytest
import torch
from PIL import Image
from shopmind.app.embedding.siglip2 import SigLIP2EmbeddingProvider


class FakeBatch(dict): pass
class FakeProcessor:
    def __call__(self,*,text=None,images=None,**kwargs):
        count=len(text if text is not None else images); return FakeBatch({"values":torch.arange(count*2,dtype=torch.float32).reshape(count,2)+1})
class FakeModel:
    def __init__(self): self.config=SimpleNamespace(projection_dim=3); self.device=torch.device("cpu"); self.eval_called=False
    def to(self,device): self.device=torch.device(device); return self
    def eval(self): self.eval_called=True; return self
    def get_text_features(self,**inputs): values=inputs["values"]; return torch.cat([values,values[:,:1]+2],dim=1)
    def get_image_features(self,**inputs): values=inputs["values"]; return torch.cat([values+1,values[:,:1]+3],dim=1)


def test_siglip2_adapter_normalizes_and_uses_model_projection_width():
    provider=SigLIP2EmbeddingProvider(model_name="fake/siglip2",model_revision="rev1",device="cpu",processor=FakeProcessor(),model=FakeModel()); vectors=provider.embed_texts(["one","two"])
    assert provider.dimension==3; assert provider.is_ready is True; assert vectors.shape==(2,3); assert vectors.dtype==np.float32; np.testing.assert_allclose(np.linalg.norm(vectors,axis=1),np.ones(2),rtol=1e-6)

def test_siglip2_adapter_embeds_images_with_same_dimension():
    provider=SigLIP2EmbeddingProvider(model_name="fake/siglip2",model_revision=None,device="cpu",processor=FakeProcessor(),model=FakeModel()); images=[Image.new("RGB",(4,4)),Image.new("RGB",(4,4))]; vectors=provider.embed_images(images)
    assert vectors.shape==(2,provider.dimension); np.testing.assert_allclose(np.linalg.norm(vectors,axis=1),np.ones(2),rtol=1e-6)

def test_empty_batches_return_correct_empty_shape():
    provider=SigLIP2EmbeddingProvider(model_name="fake/siglip2",device="cpu",processor=FakeProcessor(),model=FakeModel()); assert provider.embed_texts([]).shape==(0,3); assert provider.embed_images([]).shape==(0,3)

@pytest.mark.slow
def test_real_siglip2_text_and_image_dimensions_match():
    if os.getenv("RUN_SLOW_MODEL_TESTS")!="1": pytest.skip("set RUN_SLOW_MODEL_TESTS=1 to download/load the configured SigLIP2 model")
    provider=SigLIP2EmbeddingProvider(model_name="google/siglip2-base-patch16-224"); text=provider.embed_texts(["black running shoe"]); image=provider.embed_images([Image.new("RGB",(224,224),"black")]); assert text.shape[1]==image.shape[1]==provider.dimension; assert provider.dimension>0


def test_text_padding_is_fixed_across_batches():
    class Processor(FakeProcessor):
        def __call__(self, **kwargs):
            assert kwargs["padding"] == "max_length"
            assert kwargs["max_length"] == 64
            return super().__call__(**kwargs)
    provider=SigLIP2EmbeddingProvider("fake", processor=Processor(), model=FakeModel())
    np.testing.assert_array_equal(provider.embed_texts(["one"])[0], provider.embed_texts(["one", "a very long companion"])[0])

@pytest.mark.parametrize("features", [torch.zeros(1,3),torch.tensor([[float("nan"),1,2]]),torch.tensor([[float("inf"),1,2]])])
def test_model_rejects_invalid_vectors(features):
    provider=SigLIP2EmbeddingProvider("fake", processor=FakeProcessor(), model=FakeModel())
    with pytest.raises(ValueError): provider._normalize_numpy(features)
