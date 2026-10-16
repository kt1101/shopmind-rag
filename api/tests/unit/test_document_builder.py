from shopmind.app.domain.product import Product
from shopmind.pipeline.document_builder import build_search_text, product_to_processed_record


def test_search_text_contains_structured_product_information():
    product = Product(product_id="P1", title="Black Runner", description="Lightweight shoe", brand="Acme", category="Shoes", attributes={"gender": "men", "color": "black"}, image_paths=("p1.jpg",))
    text = build_search_text(product)
    assert text.splitlines() == ["Black Runner", "Brand: Acme", "Category: Shoes", "Lightweight shoe", "color: black", "gender: men"]


def test_processed_record_is_json_ready_and_contains_search_text():
    product = Product(product_id="P1", title="Black Runner", description="Lightweight shoe", brand=None, category="Shoes", attributes={}, image_paths=("p1.jpg", "p2.jpg"), metadata={"source": "fixture"})
    record = product_to_processed_record(product)
    assert record["product_id"] == "P1"
    assert record["main_image_path"] == "p1.jpg"
    assert record["image_paths"] == ["p1.jpg", "p2.jpg"]
    assert record["search_text"] == "Black Runner\nCategory: Shoes\nLightweight shoe"
