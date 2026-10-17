from __future__ import annotations

import json

import pytest

from shopmind.application.admin.judgments import agreement, cohens_kappa, qrels_lines, query_id_for


def test_cohens_kappa_known_values():
    assert cohens_kappa([0, 1, 2, 2], [0, 1, 2, 2]) == 1.0
    # Classic 2x2 example: observed 0.7, expected 0.5 -> kappa 0.4
    left = [1] * 20 + [1] * 5 + [0] * 10 + [0] * 15
    right = [1] * 20 + [0] * 5 + [1] * 10 + [0] * 15
    assert cohens_kappa(left, right, categories=(0, 1)) == pytest.approx(0.4)
    assert cohens_kappa([], []) is None
    assert cohens_kappa([1, 1], [1, 1]) == 1.0


def test_agreement_pairs_annotators_on_shared_items():
    rows = [
        {"query": "Boots", "product_id": "P1", "grade": 2, "annotator": "a"},
        {"query": "boots", "product_id": "P1", "grade": 2, "annotator": "b"},
        {"query": "boots", "product_id": "P2", "grade": 0, "annotator": "a"},
        {"query": "boots", "product_id": "P2", "grade": 1, "annotator": "b"},
        {"query": "boots", "product_id": "P3", "grade": 1, "annotator": "a"},  # only one annotator
    ]
    result = agreement(rows)
    assert result["pairs"] == 2 and result["annotators"] == ["a", "b"]
    assert result["by_pair"][0]["items"] == 2
    assert result["kappa"] == pytest.approx(cohens_kappa([2, 0], [2, 1]), abs=1e-4)
    assert agreement(rows[:1])["kappa"] is None


def test_qrels_lines_reuse_benchmark_ids_and_aggregate():
    rows = [
        {"query": "abis drugstore", "product_id": "P1", "grade": 1, "annotator": "a"},
        {"query": "abis drugstore", "product_id": "P1", "grade": 2, "annotator": "b"},
        {"query": "new query", "product_id": "P9", "grade": 0, "annotator": "a"},
    ]
    lines = [json.loads(line) for line in qrels_lines(rows, {"abis drugstore": "e001"})]
    assert lines[0] == {"product_id": "P1", "query_id": "e001", "relevance": 2, "query": "abis drugstore"}
    assert lines[1]["query_id"] == query_id_for("new query", {}) and lines[1]["query_id"].startswith("j_")
    assert json.loads(qrels_lines(rows, {"abis drugstore": "e001"}, aggregate="mean")[0])["relevance"] == 2


def test_judgment_endpoints(client, admin, annotator):
    for headers, grades in ((admin, [2, 0, 1]), (annotator, [2, 1, 1])):
        for product, grade in zip(["P1", "P2", "P3"], grades, strict=True):
            response = client.post("/api/v1/admin/judgments", headers=headers, json={"query": "abis drugstore", "product_id": product, "grade": grade})
            assert response.status_code == 200
    # upsert: same annotator + item updates the grade
    client.post("/api/v1/admin/judgments", headers=admin, json={"query": "abis drugstore", "product_id": "P3", "grade": 2})
    assert client.post("/api/v1/admin/judgments", headers=admin, json={"query": "q", "product_id": "P1", "grade": 3}).status_code == 422

    mine = client.get("/api/v1/admin/judgments?query=abis drugstore", headers=admin).json()["items"]
    assert {item["product_id"]: item["grade"] for item in mine} == {"P1": 2, "P2": 0, "P3": 2}
    assert all(item["annotator"] == "admin" for item in mine)
    assert len(client.get("/api/v1/admin/judgments?annotator=*", headers=admin).json()["items"]) == 6

    agreement_body = client.get("/api/v1/admin/judgments/agreement", headers=admin).json()
    assert agreement_body["pairs"] == 3 and agreement_body["kappa"] is not None

    export = client.get("/api/v1/admin/judgments/export", headers=admin)
    assert export.status_code == 200 and export.headers["content-type"].startswith("application/x-ndjson")
    assert "attachment" in export.headers["content-disposition"]
    rows = [json.loads(line) for line in export.text.splitlines()]
    assert rows[0] == {"product_id": "P1", "query_id": "e001", "relevance": 2, "query": "abis drugstore"}
    assert {row["product_id"]: row["relevance"] for row in rows} == {"P1": 2, "P2": 1, "P3": 2}
