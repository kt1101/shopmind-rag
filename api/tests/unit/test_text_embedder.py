"""A-1/A-2/A-3: dedicated text embedder, embedding text template, multi-embedder index, YAML vocabulary."""
from __future__ import annotations

import json

import numpy as np
import pytest

from scripts.generate_embeddings import generate_embeddings
from scripts.index_products import build_index_documents, public_image_url
from shopmind.application.retrieval import language
from shopmind.domain.product import Product
from shopmind.infrastructure.elasticsearch.index import build_products_mapping
from shopmind.infrastructure.embedding.sentence_transformer import SentenceTransformerEmbedder
from shopmind.infrastructure.embedding.validation import embedding_identity
from shopmind.ingestion.document_builder import render_embedding_text
from shopmind.ingestion.embedding_artifacts import load_embedding_artifacts


class FakeSTModel:
    max_seq_length = 128

    def __init__(self):
        self.calls = []

    def get_sentence_embedding_dimension(self):
        return 3

    def encode(self, texts, **kwargs):
        self.calls.append((list(texts), kwargs))
        vectors = np.array([[len(text), 1.0, 0.5] for text in texts], dtype=np.float32)
        return vectors / np.linalg.norm(vectors, axis=1, keepdims=True)


def _embedder(**kwargs):
    return SentenceTransformerEmbedder("fake/e5", "rev1", model=FakeSTModel(), query_prefix="query: ", passage_prefix="passage: ", **kwargs)


def test_sentence_transformer_uses_asymmetric_prefixes_and_is_text_only():
    embedder = _embedder()
    embedder.embed_queries(["ghế sofa"])
    embedder.embed_texts(["Grey sofa"])
    assert embedder.model.calls[0][0] == ["query: ghế sofa"]
    assert embedder.model.calls[1][0] == ["passage: Grey sofa"]
    assert embedder.model.calls[1][1]["normalize_embeddings"] is True
    assert embedder.dimension == 3 and embedder.text_only
    with pytest.raises(NotImplementedError):
        embedder.embed_images([])


def test_identity_includes_prefixes_and_document_template():
    base = embedding_identity(_embedder(document_template="{title}"))
    assert base["preprocessing"]["query_prefix"] == "query: "
    assert base != embedding_identity(_embedder(document_template="{title}\n{brand}"))


def test_render_embedding_text_drops_empty_labels_and_truncates_description():
    product = Product("P1", "Grey Sofa", "word " * 50, None, "sofa_bed", {"color": "Grey", "size": "L"}, ())
    text = render_embedding_text(product, "{title}\nBrand: {brand}\nCategory: {category}\nColor: {color}\n{attributes}\n{description}", description_chars=20)
    assert text.splitlines()[:4] == ["Grey Sofa", "Category: sofa bed", "Color: Grey", "size: L"]
    assert "Brand" not in text
    assert len(text.splitlines()[-1]) <= 20


def test_text_only_artifacts_have_no_image_matrix(tmp_path):
    processed = tmp_path / "products.jsonl"
    processed.write_text(json.dumps({"product_id": "P1", "title": "One", "description": "", "brand": None, "category": None, "attributes": {}, "image_paths": [], "main_image_path": None, "search_text": "One", "metadata": {}}) + "\n", encoding="utf-8")
    generate_embeddings(processed, tmp_path / "e5", _embedder(document_template="{title}"), "v1", None, 2, False, embedder_id="text_e5")
    manifest, ids, text, image = load_embedding_artifacts(tmp_path / "e5")
    assert ids == ["P1"] and text.shape == (1, 3) and image is None
    assert manifest.embedder_id == "text_e5" and not manifest.has_images


def test_products_mapping_supports_separate_text_dimension_and_extra_vectors():
    props = build_products_mapping(768, text_dimension=384, extra_vectors={"siglip_text_vector": 768})["mappings"]["properties"]
    assert props["text_vector"]["dims"] == 384 and props["image_vector"]["dims"] == 768 and props["siglip_text_vector"]["dims"] == 768


def test_index_documents_move_siglip_text_and_record_identities():
    rows = [{"product_id": "P1", "title": "T", "attributes": {}, "main_image_path": "data\\images\\P1.jpg"}]
    siglip_text = np.array([[1.0, 0.0]], dtype=np.float32)
    image = np.array([[0.0, 1.0]], dtype=np.float32)
    e5 = np.array([[0.6, 0.8, 0.0]], dtype=np.float32)
    [document] = build_index_documents(rows, ["P1"], siglip_text, image, embedding_model="siglip", embedding_version="r1", dedicated_text=(["P1"], e5, {"model": "e5", "model_revision": "r2"}))
    assert document["text_vector"] == pytest.approx([0.6, 0.8, 0.0])
    assert document["siglip_text_vector"] == [1.0, 0.0]
    assert document["embedding_identities"]["text_vector"] == {"model": "e5", "model_revision": "r2"}
    assert document["image_url"] == "/media/products/P1.jpg"
    assert public_image_url("data/x/P2.jpg") == "/media/products/P2.jpg"


def test_vocabulary_is_loaded_from_yaml_and_reports_applied_aliases(tmp_path):
    (tmp_path / "cat.yaml").write_text("ghế sofa: sofa\n", encoding="utf-8")
    (tmp_path / "col.yaml").write_text("gray: [xám]\n", encoding="utf-8")
    try:
        language.configure_vocabulary({"category_aliases": tmp_path / "cat.yaml", "color_aliases": tmp_path / "col.yaml"})
        normalized, applied = language.explain_lexical_query("tìm ghế sofa màu xám")
        assert normalized.split() == ["sofa", "gray"]
        assert applied == [{"from": "ghế sofa", "to": "sofa", "kind": "category"}, {"from": "xám", "to": "gray", "kind": "color"}]
        assert language.catalog_color_terms("Xám") == "gray"
    finally:
        language.configure_vocabulary()
    assert language.CATEGORY_ALIASES["giày bốt"] == "boot"
    assert language.detect_language("giày bốt da màu nâu") == "vi" and language.detect_language("brown leather boots") == "en"


def test_shipped_vocabulary_covers_common_vietnamese_shopping_words():
    language.configure_vocabulary()
    normalized, applied = language.explain_lexical_query("ba lô bằng da chống nước màu nâu")
    assert normalized.split() == ["backpack", "leather", "waterproof", "brown"]
    assert [alias["kind"] for alias in applied] == ["category", "term", "term", "color"]
    assert language.explain_lexical_query("bàn chải")[0] == "brush"  # longest phrase wins over "bàn"
    assert language.canonical_color("Multi-Colored") == "multicolor" and language.canonical_color("Marrón") == "brown"
