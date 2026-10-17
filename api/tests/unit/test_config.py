from pathlib import Path

import pytest
from pydantic import ValidationError

from shopmind.core.config import load_app_config, parse_origins

_MINIMAL_YAML = (
    "elasticsearch:\n  url: http://localhost:9200\n  index_alias: products\n"
    "embedding:\n  provider: siglip2\n  model_name: model\n"
    "retrieval:\n  default_mode: hybrid\n  top_k: 10\n  candidate_k: 100\n"
    "fusion:\n  method: rrf\n  rrf_k: 60\n"
    "reranker:\n  enabled: false\n"
)


def _minimal_config(tmp_path: Path, extra: str = "") -> Path:
    cfg = tmp_path / "app.yaml"
    cfg.write_text(_MINIMAL_YAML + extra)
    return cfg


def test_load_app_config_uses_yaml_and_env(monkeypatch, tmp_path: Path):
    cfg = _minimal_config(tmp_path)
    monkeypatch.setenv("ELASTICSEARCH_USERNAME", "elastic")
    monkeypatch.setenv("ELASTICSEARCH_PASSWORD", "secret")
    loaded = load_app_config(cfg)
    assert loaded.elasticsearch.index_alias == "products"
    assert loaded.elasticsearch.username == "elastic"
    assert loaded.elasticsearch.password == "secret"


def test_env_can_override_elasticsearch_url_and_hf_token(monkeypatch, tmp_path: Path):
    cfg = _minimal_config(tmp_path)
    monkeypatch.setenv("ELASTICSEARCH_URL", "https://es.example.test")
    monkeypatch.setenv("HF_TOKEN", "hf-secret")
    loaded = load_app_config(cfg)
    assert loaded.elasticsearch.url == "https://es.example.test"
    assert loaded.embedding.hf_token == "hf-secret"


def test_openai_model_comes_from_env(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("OPENAI_MODEL", "gpt-test-mini")
    assert load_app_config(_minimal_config(tmp_path)).rag.llm.model == "gpt-test-mini"


def test_parse_origins():
    assert parse_origins("http://localhost:3000, https://shop.example.test ,") == ["http://localhost:3000", "https://shop.example.test"]
    assert parse_origins("") == []


def test_empty_env_values_keep_defaults(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("OPENAI_MODEL", "")
    loaded = load_app_config(_minimal_config(tmp_path))
    assert loaded.rag.llm.model == "gpt-5.4-mini" and loaded.rag.llm.timeout_seconds == 60
    assert loaded.rag.chat.sources == ["product", "policy"]
    assert loaded.rag.chat.include_reviews_when_available is True


def test_chat_config_rejects_unknown_keys_and_empty_sources(tmp_path: Path):
    with pytest.raises(ValidationError):
        load_app_config(_minimal_config(tmp_path, "rag:\n  chat:\n    unknown: 1\n"))
    with pytest.raises(ValidationError):
        load_app_config(_minimal_config(tmp_path, "rag:\n  chat:\n    sources: []\n"))
