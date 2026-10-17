from __future__ import annotations

import asyncio
import json
import logging
import threading
import time

import pytest
from fastapi.testclient import TestClient

from shopmind.application.chat.models import ChatEvent, PreparedChat
from shopmind.main import create_app
from shopmind.application.rag.models import Citation, PreparedContext, RAGAnswer, RAGContext, RAGRequest
from shopmind.application.rag.service import KnowledgeRetrievalUnavailable
from tests.api.conftest import FakeEmbedder, FakeRepository, FakeSearchService

MESSAGE_MARKER = "zz-message-marker-91"
ANSWER_MARKER = "zz-answer-marker-47"


def _prepared(message: str) -> PreparedChat:
    counts = {"product": 1, "policy": 0}
    context = RAGContext((), "", (), {"source_counts": counts})
    return PreparedChat(
        standalone_question=f"standalone: {message}",
        rewrite_fallback=False,
        request=RAGRequest(message, sources=("product", "policy")),
        prepared=PreparedContext(context, {"source_counts": counts}, 0.0),
    )


class FakeChatService:
    def __init__(self, answer_text: str = "It fits well.", prepare_error: Exception | None = None):
        self.answer_text = answer_text
        self.prepare_error = prepare_error
        self.prepare_calls = []
        self.cancelled: threading.Event | None = None

    def _answer(self) -> RAGAnswer:
        return RAGAnswer(self.answer_text, (Citation("product:P1", "product", "Black Runner", 0.5, product_id="P1"),), False, {"generation_attempts": 1, "total_ms": 12.5})

    def prepare(self, message, history, product_id, *, image_token=None, session_id=None):
        self.prepare_calls.append((message, list(history), product_id))
        if self.prepare_error is not None:
            raise self.prepare_error
        return _prepared(message)

    def answer(self, prepared):
        return self._answer()

    def stream(self, prepared, cancelled, *, trace_id=None, on_finish=None):
        self.cancelled = cancelled
        yield ChatEvent("meta", {"standalone_question": prepared.standalone_question, "rewrite_fallback": False})
        yield ChatEvent("delta", {"text": self.answer_text})
        yield ChatEvent("done", {"answer": self.answer_text})


def _client(chat_service=None, **kwargs):
    app = create_app(search_service=FakeSearchService(), repository=FakeRepository(), embedder=FakeEmbedder(), chat_service=chat_service, auto_wire=False, **kwargs)
    return TestClient(app)


@pytest.fixture
def chat_service():
    return FakeChatService()


@pytest.fixture
def chat_client(chat_service):
    with _client(chat_service) as client:
        yield client


def test_chat_json_response(chat_client, chat_service):
    response = chat_client.post("/api/v1/chat", json={"message": " Hi ", "history": [{"role": "user", "content": "Earlier"}], "product_id": " P1 "})

    assert response.status_code == 200
    body = response.json()
    assert body["answer"] == "It fits well."
    assert body["standalone_question"] == "standalone: Hi"
    assert body["insufficient_evidence"] is False
    assert body["sources"] == [{"citation_id": "product:P1", "document_id": "product:P1", "source": "product", "title": "Black Runner", "score": 0.5, "product_id": "P1", "policy_version": None, "source_url": None, "url": None, "snippet": None, "image_url": None, "metadata": {}}]
    message, history, product_id = chat_service.prepare_calls[0]
    assert (message, product_id) == ("Hi", "P1")
    assert [(turn.role, turn.content) for turn in history] == [("user", "Earlier")]


def test_chat_stream_event_order_and_headers(chat_client):
    with chat_client.stream("POST", "/api/v1/chat/stream", json={"message": "Hi"}) as response:
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/event-stream")
        assert response.headers["cache-control"] == "no-cache"
        assert response.headers["x-accel-buffering"] == "no"
        lines = list(response.iter_lines())
    events = [line.split(": ", 1)[1] for line in lines if line.startswith("event: ")]
    assert events == ["meta", "delta", "done"]
    meta = json.loads(next(line for line in lines if line.startswith("data: ")).split(": ", 1)[1])
    assert meta == {"standalone_question": "standalone: Hi", "rewrite_fallback": False}


def test_chat_stream_prepare_failure_is_http_503():
    service = FakeChatService(prepare_error=KnowledgeRetrievalUnavailable("policies index missing"))
    with _client(service) as client:
        response = client.post("/api/v1/chat/stream", json={"message": "Hi"})
    assert response.status_code == 503
    assert response.headers["content-type"].startswith("application/json")
    assert response.json()["error"]["code"] == "rag_dependency_unavailable"


def test_chat_unavailable_without_service():
    with _client() as client:
        for path in ("/api/v1/chat", "/api/v1/chat/stream"):
            response = client.post(path, json={"message": "Hi"})
            assert response.status_code == 503
            assert response.json()["error"]["code"] == "rag_unavailable"


@pytest.mark.parametrize(
    "payload",
    [
        {"message": "   "},
        {"message": "x" * 2001},
        {"message": "Hi", "history": [{"role": "system", "content": "x"}]},
        {"message": "Hi", "history": [{"role": "user", "content": ""}]},
        {"message": "Hi", "history": [{"role": "user", "content": "x" * 4001}]},
        {"message": "Hi", "product_id": "  "},
        {"message": "Hi", "product_id": "p" * 129},
        {"message": "Hi", "history": [{"role": "user", "content": "x"}] * 13},
    ],
)
def test_chat_validation(chat_client, payload):
    for path in ("/api/v1/chat", "/api/v1/chat/stream"):
        response = chat_client.post(path, json=payload)
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "validation_error"


def test_chat_accepts_twelve_history_items(chat_client):
    history = [{"role": "user" if i % 2 == 0 else "assistant", "content": f"turn {i}"} for i in range(12)]
    assert chat_client.post("/api/v1/chat", json={"message": "Hi", "history": history}).status_code == 200


@pytest.mark.asyncio
async def test_client_disconnect_sets_cancel_flag():
    class SlowChatService(FakeChatService):
        closed = False

        def stream(self, prepared, cancelled, **_):
            self.cancelled = cancelled
            try:
                yield ChatEvent("meta", {"standalone_question": "q", "rewrite_fallback": False})
                for _ in range(100):
                    time.sleep(0.05)  # never checks the flag: only close() can end it early
                    yield ChatEvent("delta", {"text": "x"})
            finally:
                self.closed = True

    service = SlowChatService()
    app = create_app(search_service=FakeSearchService(), repository=FakeRepository(), embedder=FakeEmbedder(), chat_service=service, auto_wire=False)
    body = json.dumps({"message": "Hi"}).encode()
    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "POST",
        "scheme": "http",
        "path": "/api/v1/chat/stream",
        "raw_path": b"/api/v1/chat/stream",
        "query_string": b"",
        "headers": [(b"host", b"testserver"), (b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())],
        "client": ("127.0.0.1", 1234),
        "server": ("testserver", 80),
    }
    sent_body = False
    messages = []

    async def receive():
        nonlocal sent_body
        if not sent_body:
            sent_body = True
            return {"type": "http.request", "body": body, "more_body": False}
        await asyncio.sleep(0.2)
        return {"type": "http.disconnect"}

    async def send(message):
        messages.append(message)

    started = time.monotonic()
    await asyncio.wait_for(app(scope, receive, send), timeout=10)

    assert time.monotonic() - started < 4  # the fake would otherwise stream for ~5s

    assert service.cancelled is not None and service.cancelled.is_set()
    assert service.closed  # the generator's finally ran (upstream stream would be closed) before the call returned


def test_logs_contain_no_message_or_answer_text(caplog):
    caplog.set_level(logging.DEBUG)
    service = FakeChatService(answer_text=ANSWER_MARKER)
    with _client(service) as client:
        assert client.post("/api/v1/chat", json={"message": MESSAGE_MARKER}).status_code == 200
        with client.stream("POST", "/api/v1/chat/stream", json={"message": MESSAGE_MARKER}) as response:
            body = "".join(response.iter_text())
    assert ANSWER_MARKER in body
    assert any(record.name == "shopmind.chat" for record in caplog.records)
    assert MESSAGE_MARKER not in caplog.text
    assert ANSWER_MARKER not in caplog.text


def test_normal_stream_close_logs_no_warning(caplog):
    caplog.set_level(logging.WARNING)
    with _client(FakeChatService()) as client:
        with client.stream("POST", "/api/v1/chat/stream", json={"message": "Hi"}) as response:
            "".join(response.iter_text())
    assert [record for record in caplog.records if record.levelno >= logging.WARNING] == []


def test_cors_only_when_configured(monkeypatch):
    monkeypatch.delenv("CORS_ORIGINS", raising=False)
    preflight = {"Origin": "http://localhost:3000", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type"}

    with _client(FakeChatService()) as client:
        response = client.options("/api/v1/chat/stream", headers=preflight)
        assert "access-control-allow-origin" not in response.headers

    with _client(FakeChatService(), cors_origins=["http://localhost:3000"]) as client:
        response = client.options("/api/v1/chat/stream", headers=preflight)
        assert response.status_code == 200
        assert response.headers["access-control-allow-origin"] == "http://localhost:3000"
        response = client.get("/health", headers={"Origin": "http://localhost:3000"})
        assert "x-request-id" in response.headers["access-control-expose-headers"].lower()


def test_cors_origins_read_from_environment(monkeypatch):
    monkeypatch.setenv("CORS_ORIGINS", "http://a.test, http://b.test")
    with _client(FakeChatService()) as client:
        response = client.get("/health", headers={"Origin": "http://b.test"})
    assert response.headers["access-control-allow-origin"] == "http://b.test"
