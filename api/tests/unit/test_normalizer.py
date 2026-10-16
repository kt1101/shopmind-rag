import json
from pathlib import Path
from shopmind.pipeline.normalizer import normalize_abo_record


def test_normalizer_builds_canonical_product_and_main_image():
    record={"item_id":"P1","item_name":[{"language_tag":"en_US","value":"Black Runner"}],"brand":[{"language_tag":"en_US","value":"Acme"}],"product_type":[{"value":"SHOES"}],"bullet_point":[{"language_tag":"en_US","value":"Lightweight"}],"main_image_id":"IMG1","other_image_id":["IMG2"]}
    product=normalize_abo_record(record,{"IMG1":"data/raw/images/IMG1.jpg","IMG2":"data/raw/images/IMG2.jpg"})
    assert product.product_id=="P1"; assert product.title=="Black Runner"; assert product.brand=="Acme"; assert product.category=="SHOES"; assert product.description=="Lightweight"; assert product.main_image_path=="data/raw/images/IMG1.jpg"; assert product.image_paths==("data/raw/images/IMG1.jpg","data/raw/images/IMG2.jpg")


def test_normalizer_prefers_english_and_preserves_unmapped_image_ids():
    record={"item_id":"P3","item_name":[{"language_tag":"vi_VN","value":"Đèn bàn"},{"language_tag":"en_GB","value":"Desk   Lamp"}],"main_image_id":"MISSING","other_image_id":["ALSO_MISSING"]}
    product=normalize_abo_record(record,{})
    assert product.title=="Desk Lamp"; assert product.image_paths==(); assert product.metadata["unmapped_image_ids"]==["MISSING","ALSO_MISSING"]


def test_fixture_records_are_normalizable():
    fixture=Path("tests/fixtures/abo_products.jsonl"); image_map=json.loads(Path("tests/fixtures/image_map.json").read_text()); products=[normalize_abo_record(json.loads(line),image_map) for line in fixture.read_text().splitlines()]
    assert [p.product_id for p in products]==["P1","P2","P3","P4"]
