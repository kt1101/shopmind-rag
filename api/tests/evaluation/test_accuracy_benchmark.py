import hashlib
import json
from pathlib import Path

import pytest

from evaluation.datasets import load_qrels, load_queries


ROOT = Path(__file__).resolve().parents[2]
FROZEN = ROOT / "evaluation/benchmarks/accuracy_v2"
CORPUS = ROOT / "data/a1_abo_1500/products.jsonl"


def test_benchmark_is_complete_disjoint_and_reproducible(tmp_path):
    from scripts.build_accuracy_benchmark import build_accuracy_benchmark

    build_accuracy_benchmark(CORPUS, tmp_path, seed=42)
    manifest = json.loads((tmp_path / "manifest.json").read_text())
    products = [json.loads(line) for line in CORPUS.read_text().splitlines()]
    queries = load_queries(tmp_path / "queries.jsonl")
    qrels = load_qrels(tmp_path / "qrels.jsonl", queries)
    assert len(queries) == 160
    assert manifest["counts"]["predicate_groups"] == 60
    assert manifest["counts"]["exact_id_probes"] == 40
    intents = {}
    positive_splits = {"dev": set(), "holdout": set()}
    for query in queries:
        positive_splits[query.split].update(qrels[query.query_id])
        intents.setdefault(query.intent_id, []).append(query)
    assert positive_splits["dev"].isdisjoint(positive_splits["holdout"])
    images_by_split = {
        split: {product["metadata"]["main_image_id"] for product in products if product["product_id"] in ids}
        for split, ids in positive_splits.items()
    }
    assert images_by_split["dev"].isdisjoint(images_by_split["holdout"])
    category_splits = manifest["category_splits"]
    for intent_id, variants in intents.items():
        predicate = manifest["predicates"][intent_id]
        if predicate["kind"] == "exact_id":
            expected = {predicate["product_id"]}
            assert len(variants) == 1
        else:
            assert {query.language for query in variants} == {"en", "vi"}
            values = manifest["aliases"]["colors"].get(predicate.get("color"), {}).get("metadata_values", [])
            expected = {
                product["product_id"] for product in products
                if product["category"] == predicate["category"]
                and ("brand" not in predicate or product["brand"] == predicate["brand"])
                and ("color" not in predicate or product["attributes"].get("color", "").strip().casefold() in values)
            }
        assert 1 <= len(expected) <= 20
        for query in variants:
            assert set(qrels[query.query_id]) == expected
            assert query.split == category_splits[predicate["category"]]
        assert len({query.split for query in variants}) == 1
    assert len({query.query for query in queries}) == len(queries)
    for filename in ("queries.jsonl", "qrels.jsonl"):
        digest = hashlib.sha256((tmp_path / filename).read_bytes()).hexdigest()
        assert digest == manifest["hashes"][filename]
        assert (tmp_path / filename).read_bytes() == (FROZEN / filename).read_bytes()
    assert (tmp_path / "manifest.json").read_bytes() == (FROZEN / "manifest.json").read_bytes()
    assert manifest["hashes"]["corpus"] == hashlib.sha256(CORPUS.read_bytes()).hexdigest()
    assert manifest["label_status"] == "metadata_grounded"


def test_small_corpus_keeps_every_variant_positive_and_reports_shortfall(tmp_path):
    from scripts.build_accuracy_benchmark import build_accuracy_benchmark

    products = [
        {"product_id": "p1", "category": "SHOES", "brand": "Acme", "attributes": {"color": "Black"}},
        {"product_id": "p2", "category": "SHOES", "brand": "Acme", "attributes": {"color": "Noir"}},
        {"product_id": "p3", "category": "SHOES", "brand": "Other", "attributes": {"color": "Black"}},
        {"product_id": "p4", "category": "SHOES", "brand": "Acme", "attributes": {"color": "Black/White"}},
    ]
    path = tmp_path / "products.jsonl"
    path.write_text("".join(json.dumps(product) + "\n" for product in products))
    output = build_accuracy_benchmark(path, tmp_path / "benchmark")
    queries = load_queries(output / "queries.jsonl")
    qrels = load_qrels(output / "qrels.jsonl", queries)
    manifest = json.loads((output / "manifest.json").read_text())
    assert manifest["counts"]["predicate_groups"] == 5
    assert manifest["counts"]["exact_id_probes"] == 4
    black = [query for query in queries if query.group == "category_color"]
    assert len(black) == 2
    assert all(set(qrels[query.query_id]) == {"p1", "p2", "p3"} for query in black)
    acme = [query for query in queries if query.query == "Find shoes from Acme."]
    assert set(qrels[acme[0].query_id]) == {"p1", "p2", "p4"}


@pytest.mark.parametrize("provenance", [{"split": "training"}, {"split": 1}, {"intent_id": ""}, {"intent_id": 42}])
def test_loader_rejects_invalid_benchmark_provenance(tmp_path, provenance):
    path = tmp_path / "queries.jsonl"
    path.write_text(json.dumps({"query_id": "q1", "query": "chair", **provenance}) + "\n")
    with pytest.raises(ValueError):
        load_queries(path)


def test_benchmark_rejects_duplicate_product_ids(tmp_path):
    from scripts.build_accuracy_benchmark import build_accuracy_benchmark

    path = tmp_path / "products.jsonl"
    path.write_text('{"product_id":"p1","category":"CHAIR","brand":"Rivet","attributes":{}}\n' * 2)
    with pytest.raises(ValueError, match="duplicate product_id"):
        build_accuracy_benchmark(path, tmp_path / "benchmark")
