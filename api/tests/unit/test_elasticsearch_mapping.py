from shopmind.app.infrastructure.elasticsearch.index import build_products_mapping


def test_mapping_uses_manifest_dimension_for_both_vectors():
    mapping = build_products_mapping(4); props = mapping["mappings"]["properties"]
    assert props["text_vector"]["type"] == "dense_vector"
    assert props["text_vector"]["dims"] == 4
    assert props["text_vector"]["similarity"] == "cosine"
    assert props["image_vector"]["dims"] == 4
    assert props["product_id"]["type"] == "keyword"
    assert props["title"]["type"] == "text"
    assert props["brand"]["fields"]["keyword"]["type"] == "keyword"
    assert props["category"]["fields"]["keyword"]["type"] == "keyword"


def test_mapping_rejects_non_positive_dimension():
    try: build_products_mapping(0)
    except ValueError as exc: assert "dimension" in str(exc)
    else: raise AssertionError("zero vector dimension must fail")
