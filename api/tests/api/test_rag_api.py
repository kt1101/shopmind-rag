from __future__ import annotations

from fastapi.testclient import TestClient

from shopmind.infrastructure.llm.base import LLMProviderError
from shopmind.main import create_app
from shopmind.application.rag.models import Citation, RAGAnswer
from tests.api.conftest import FakeEmbedder, FakeRepository, FakeSearchService


class FakeRAGService:
    def __init__(self):
        self.requests = []

    def answer(self, request):
        self.requests.append(request)
        return RAGAnswer("The review says it fits.", (Citation("review:R1", "review", "Fit review", 0.031, product_id="P1"),))


def _client(rag_service=None):
    app = create_app(search_service=FakeSearchService(), repository=FakeRepository(), embedder=FakeEmbedder(), rag_service=rag_service, auto_wire=False)
    return TestClient(app)


def test_ask_scopes_selected_product_and_returns_server_sources_with_scores():
    service = FakeRAGService()

    with _client(service) as client:
        response = client.post("/api/v1/rag/ask", json={"question": "Does it fit?", "product_id": " P1 ", "sources": ["product", "review"], "debug": True})

    assert response.status_code == 200
    assert service.requests[0].product_id == "P1"
    assert service.requests[0].sources == ("product", "review")
    assert response.json()["answer"] == "The review says it fits."
    assert response.json()["sources"] == [{"citation_id": "review:R1", "document_id": "review:R1", "source": "review", "title": "Fit review", "score": 0.031, "product_id": "P1", "policy_version": None, "source_url": None, "url": None, "snippet": None, "image_url": None, "metadata": {}}]


def test_ask_rejects_invalid_input_and_reports_missing_service():
    with _client() as client:
        assert client.post("/api/v1/rag/ask", json={"question": "  "}).status_code == 422
        assert client.post("/api/v1/rag/ask", json={"question": "x", "product_id": "  "}).status_code == 422
        assert client.post("/api/v1/rag/ask", json={"question": "x", "sources": ["unknown"]}).status_code == 422
        response = client.post("/api/v1/rag/ask", json={"question": "x"})
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "rag_unavailable"


def test_ask_returns_controlled_error_when_llm_is_unavailable():
    class Unavailable:
        def answer(self, request):
            raise LLMProviderError("OPENAI_API_KEY is not configured")

    with _client(Unavailable()) as client:
        response = client.post("/api/v1/rag/ask", json={"question": "Return window?"})

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "llm_unavailable"


def test_actual_service_repairs_malformed_output_and_preserves_debug_scope():
    from tests.a3.test_a3_quality import ScriptedProvider, product, structured
    from tests.a3.test_a3_service import Retriever, _service

    provider = ScriptedProvider(["malformed", structured()])
    service = _service({"product": Retriever("product", [product()])}, provider)
    with _client(service) as client:
        response = client.post("/api/v1/rag/ask", json={"question": "Color?", "product_id": "P1", "sources": ["product"], "debug": True})
    assert response.status_code == 200
    assert response.json()["metadata"]["generation_attempts"] == 2
    assert response.json()["metadata"]["context_ids"] == ["product:P1"]
    assert response.json()["sources"][0]["product_id"] == "P1"


def test_actual_service_rejects_two_blank_answers_with_controlled_error():
    from tests.a3.test_a3_quality import ScriptedProvider, product, structured
    from tests.a3.test_a3_service import Retriever, _service

    provider = ScriptedProvider([structured(" "), structured(" ")])
    service = _service({"product": Retriever("product", [product()])}, provider)
    with _client(service) as client:
        response = client.post("/api/v1/rag/ask", json={"question": "Color?", "sources": ["product"]})
    assert response.status_code == 502
    assert response.json()["error"]["code"] == "rag_generation_failed"
    assert len(provider.calls) == 2
