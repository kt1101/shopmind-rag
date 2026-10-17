from __future__ import annotations

from datetime import UTC, datetime, timedelta

import jwt
import pytest
from fastapi.testclient import TestClient

from shopmind.infrastructure.auth import AuthNotConfigured, AuthService, InvalidToken
from shopmind.main import create_app
from tests.platform.conftest import ADMIN_PASSWORD, JWT_SECRET, make_config


def test_login_returns_token_and_user(client):
    response = client.post("/api/v1/admin/auth/login", json={"username": "admin", "password": ADMIN_PASSWORD})
    assert response.status_code == 200
    body = response.json()
    assert body["token_type"] == "bearer" and body["expires_in"] == 480 * 60
    assert body["user"] == {"username": "admin", "role": "admin"}
    me = client.get("/api/v1/admin/auth/me", headers={"authorization": f"Bearer {body['access_token']}"})
    assert me.json() == {"username": "admin", "role": "admin"}


def test_bad_password_and_unknown_user_are_401(client):
    for username, password in (("admin", "wrong"), ("ghost", "whatever")):
        response = client.post("/api/v1/admin/auth/login", json={"username": username, "password": password})
        assert response.status_code == 401
        body = response.json()
        assert body["error"]["code"] == "invalid_credentials" and body["request_id"]
        assert ADMIN_PASSWORD not in response.text


@pytest.mark.parametrize("path", ["/api/v1/admin/auth/me", "/api/v1/admin/stats", "/api/v1/admin/config", "/api/v1/admin/config/profiles", "/api/v1/admin/traces", "/api/v1/admin/indexes", "/api/v1/admin/jobs", "/api/v1/admin/policies", "/api/v1/admin/eval-runs", "/api/v1/admin/feedback", "/api/v1/admin/judgments", "/api/v1/admin/judgments/export", "/api/v1/admin/judgments/agreement"])
def test_admin_endpoints_require_a_bearer_token(client, path):
    response = client.get(path)
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unauthorized"
    assert set(response.json()) == {"error", "request_id"}


def test_expired_and_forged_tokens_are_rejected(client):
    now = datetime.now(UTC)
    expired = jwt.encode({"sub": "admin", "role": "admin", "iss": "shopmind", "iat": int((now - timedelta(hours=2)).timestamp()), "exp": int((now - timedelta(hours=1)).timestamp())}, JWT_SECRET, algorithm="HS256")
    forged = jwt.encode({"sub": "admin", "role": "admin", "iss": "shopmind", "exp": int((now + timedelta(hours=1)).timestamp())}, "another-secret-0123456789abcdefghij", algorithm="HS256")
    for token in (expired, forged, "not-a-jwt"):
        response = client.get("/api/v1/admin/auth/me", headers={"authorization": f"Bearer {token}"})
        assert response.status_code == 401 and response.json()["error"]["code"] == "unauthorized"


def test_annotator_cannot_change_config_but_can_read(client, annotator):
    assert client.get("/api/v1/admin/stats", headers=annotator).status_code == 200
    response = client.put("/api/v1/admin/config", headers=annotator, json={"name": "x", "overrides": {"retrieval.top_k": 5}})
    assert response.status_code == 403 and response.json()["error"]["code"] == "forbidden"


def test_missing_secret_refuses_to_issue_tokens(tmp_path):
    app = create_app(auto_wire=False, config=make_config(tmp_path, auth={"jwt_secret": None}))
    client = TestClient(app)
    response = client.post("/api/v1/admin/auth/login", json={"username": "admin", "password": ADMIN_PASSWORD})
    assert response.status_code == 503 and response.json()["error"]["code"] == "auth_not_configured"
    assert client.get("/api/v1/admin/auth/me", headers={"authorization": "Bearer x"}).status_code == 401
    service = app.state.container.auth_service
    with pytest.raises(AuthNotConfigured):
        service.issue({"username": "admin", "role": "admin"})


def test_service_verify_checks_role_claim(app):
    service: AuthService = app.state.container.auth_service
    token = jwt.encode({"sub": "admin", "role": "root", "iss": "shopmind", "exp": int((datetime.now(UTC) + timedelta(minutes=5)).timestamp())}, JWT_SECRET, algorithm="HS256")
    with pytest.raises(InvalidToken):
        service.verify(token)
    issued = service.issue({"username": "admin", "role": "admin"})
    assert service.verify(issued["access_token"]) == {"username": "admin", "role": "admin"}


def test_auth_disabled_allows_admin_calls_without_token(tmp_path):
    client = TestClient(create_app(auto_wire=False, config=make_config(tmp_path, auth={"enabled": False})))
    assert client.get("/api/v1/admin/auth/me").json() == {"username": "anonymous", "role": "admin"}
