from __future__ import annotations

import os
from pathlib import Path
from collections.abc import Mapping
from typing import Any, Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field


class ElasticsearchConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    url: str
    index_alias: str = "products"
    username: str | None = None
    password: str | None = None


class EmbeddingConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    provider: str = "siglip2"
    model_name: str
    model_revision: str | None = None
    batch_size: int = Field(default=32, gt=0)
    hf_token: str | None = None


class RetrievalConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    default_mode: str = "hybrid"
    top_k: int = Field(default=10, gt=0)
    candidate_k: int = Field(default=100, gt=0)


class FusionConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    method: str = "rrf"
    lexical_preserving: bool = False
    rrf_k: int = Field(default=60, gt=0)


class RerankerConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: bool = False


class ApiConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    max_image_bytes: int = Field(default=5 * 1024 * 1024, gt=0)


class RAGRetrievalConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    product_mode: Literal["bm25", "dense", "hybrid", "adaptive"] = "hybrid"
    review_mode: Literal["bm25", "dense", "hybrid", "adaptive"] = "hybrid"
    policy_mode: Literal["bm25", "dense", "hybrid", "adaptive"] = "hybrid"
    product_candidates: int = Field(default=20, gt=0)
    review_candidates: int = Field(default=40, gt=0)
    policy_candidates: int = Field(default=20, gt=0)


class RAGFusionConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    method: Literal["rrf", "concat"] = "rrf"
    rrf_k: int = Field(default=60, gt=0)
    top_k: int = Field(default=40, gt=0)


class RAGRerankerConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: bool = False
    model_name: str = "BAAI/bge-reranker-v2-m3"
    top_k: int = Field(default=12, gt=0)


class RAGContextConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    max_documents: int = Field(default=12, gt=0)
    max_product: int = Field(default=4, ge=0)
    max_reviews: int = Field(default=5, ge=0)
    max_policies: int = Field(default=3, ge=0)
    max_characters: int = Field(default=24000, gt=0)


class RAGLLMConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    provider: str = "openai"  # registry name (kind "llm"): openai | ollama
    model: str = "gpt-5.4-mini"
    api_key: str | None = None
    base_url: str = "http://localhost:11434"
    max_generation_attempts: int = Field(default=2, ge=1, le=2)
    timeout_seconds: float = Field(default=60, gt=0)


class ChatConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    sources: list[Literal["product", "review", "policy"]] = Field(default_factory=lambda: ["product", "policy"], min_length=1)
    include_reviews_when_available: bool = True


class RAGConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: bool = False
    retrieval: RAGRetrievalConfig = Field(default_factory=RAGRetrievalConfig)
    fusion: RAGFusionConfig = Field(default_factory=RAGFusionConfig)
    reranker: RAGRerankerConfig = Field(default_factory=RAGRerankerConfig)
    context: RAGContextConfig = Field(default_factory=RAGContextConfig)
    llm: RAGLLMConfig = Field(default_factory=RAGLLMConfig)
    chat: ChatConfig = Field(default_factory=ChatConfig)


class DatabaseConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: bool = True
    url: str = "sqlite:///./data/shopmind.db"
    echo: bool = False
    # Create missing tables with ``metadata.create_all`` (and stamp Alembic head) at startup.
    # Dev/tests only; docker runs ``alembic upgrade head`` in the entrypoint instead.
    auto_create: bool = False
    connect_timeout_seconds: int = Field(default=5, gt=0)
    # Seed the policy CMS from ``jobs.policies_source`` when the table is empty.
    seed_policies: bool = True


class AuthConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: bool = True
    jwt_secret: str | None = None
    jwt_algorithm: str = "HS256"
    token_ttl_minutes: int = Field(default=480, gt=0)
    admin_username: str = "admin"
    admin_password: str | None = None


class EmbedderSpec(BaseModel):
    """A named embedding model. ``impl`` is a registry name (kind ``embedder``)."""
    model_config = ConfigDict(extra="forbid")
    impl: str
    model_name: str
    revision: str | None = None
    modalities: list[Literal["text", "image"]] = Field(default_factory=lambda: ["text"])
    params: dict[str, Any] = Field(default_factory=dict)


class IndexSpec(BaseModel):
    """A logical index. The app only ever addresses ``alias``; ``vectors`` maps field → embedder id."""
    model_config = ConfigDict(extra="forbid")
    alias: str
    vectors: dict[str, str] = Field(default_factory=dict)


class StepSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")
    step: str
    impl: str
    id: str | None = None
    enabled: bool = True
    when: str | None = None
    params: dict[str, Any] = Field(default_factory=dict)

    @property
    def key(self) -> str:
        return self.id or self.step


class PipelineSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["search", "image_search", "compose_search", "rag", "chat", "compare", "knowledge"] = "search"
    description: str = ""
    public: bool = True
    steps: list[StepSpec] = Field(default_factory=list)


class TracingConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: bool = True
    store: str = "memory"
    memory_capacity: int = Field(default=500, gt=0)
    max_items_per_step: int = Field(default=20, gt=0)
    retention_days: int = Field(default=7, gt=0)


class FeaturesConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    compose_default_alpha: float = Field(default=0.7, ge=0, le=1)
    query_understanding: Literal["rules", "llm", "off"] = "rules"
    synthetic_commerce: bool = True
    chat_image_ttl_seconds: int = Field(default=900, gt=0)
    rate_limit_per_minute: int = Field(default=30, ge=0)


class JobsConfig(BaseModel):
    """In-process admin jobs (reindex policies, run eval, build embedding map)."""
    model_config = ConfigDict(extra="forbid")
    enabled: bool = True
    max_workers: int = Field(default=2, gt=0)
    # Writable directory for job artifacts (policy exports, embeddings); relative to the API cwd.
    work_dir: str = "data/jobs"
    log_tail_chars: int = Field(default=20000, gt=0)
    timeout_seconds: int = Field(default=3600, gt=0)
    runs_dir: str = "runs"
    import_runs_on_startup: bool = True
    policies_source: str = "data/policies"
    # New physical policy indexes are named ``<policy_index_prefix><N>`` (N = previous + 1).
    policy_index_prefix: str = "policies_a3_v"
    eval_config: str = "configs/experiments/hybrid_rrf.yaml"
    eval_queries: str = "evaluation/benchmarks/a1/queries.jsonl"
    eval_qrels: str = "evaluation/benchmarks/a1/qrels.jsonl"
    embedding_map_output: str = "data/embedding_map"


class AppConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    elasticsearch: ElasticsearchConfig
    embedding: EmbeddingConfig
    retrieval: RetrievalConfig
    fusion: FusionConfig
    reranker: RerankerConfig
    api: ApiConfig = Field(default_factory=ApiConfig)
    rag: RAGConfig = Field(default_factory=RAGConfig)
    database: DatabaseConfig = Field(default_factory=DatabaseConfig)
    auth: AuthConfig = Field(default_factory=AuthConfig)
    embedders: dict[str, EmbedderSpec] = Field(default_factory=dict)
    indexes: dict[str, IndexSpec] = Field(default_factory=lambda: {name: IndexSpec(alias=name) for name in ("products", "reviews", "policies")})
    prompts: dict[str, str] = Field(default_factory=dict)
    vocabularies: dict[str, str] = Field(default_factory=dict)
    pipelines: dict[str, PipelineSpec] = Field(default_factory=dict)
    defaults: dict[str, str] = Field(default_factory=dict)
    tracing: TracingConfig = Field(default_factory=TracingConfig)
    features: FeaturesConfig = Field(default_factory=FeaturesConfig)
    plugins: list[str] = Field(default_factory=list)
    hot_reloadable: list[str] = Field(default_factory=list)
    jobs: JobsConfig = Field(default_factory=JobsConfig)

    def index_alias(self, name: str) -> str:
        return self.indexes[name].alias if name in self.indexes else name


def _overlay_env(data: dict[str, Any]) -> dict[str, Any]:
    elasticsearch = dict(data.get("elasticsearch") or {})
    embedding = dict(data.get("embedding") or {})
    env_mapping = {"ELASTICSEARCH_URL": (elasticsearch, "url"), "ELASTICSEARCH_USERNAME": (elasticsearch, "username"), "ELASTICSEARCH_PASSWORD": (elasticsearch, "password"), "HF_TOKEN": (embedding, "hf_token")}
    for env_name, (section, key) in env_mapping.items():
        value = os.getenv(env_name)
        if value is not None and value != "":
            section[key] = value
    data = dict(data)
    data["elasticsearch"] = elasticsearch
    data["embedding"] = embedding
    llm_overrides = {key: value for key, env_name in (("api_key", "OPENAI_API_KEY"), ("model", "OPENAI_MODEL")) if (value := os.getenv(env_name))}
    if value := os.getenv("OLLAMA_BASE_URL"):
        rag = dict(data.get("rag") or {})
        rag["llm"] = {**(rag.get("llm") or {}), "base_url": value}
        data["rag"] = rag
    simple = {"DATABASE_URL": ("database", "url"), "JWT_SECRET": ("auth", "jwt_secret"), "ADMIN_USERNAME": ("auth", "admin_username"), "ADMIN_PASSWORD": ("auth", "admin_password")}
    for env_name, (section, key) in simple.items():
        if value := os.getenv(env_name):
            data[section] = {**(data.get(section) or {}), key: value}
    if llm_overrides:
        rag = dict(data.get("rag") or {})
        rag["llm"] = {**(rag.get("llm") or {}), **llm_overrides}
        data["rag"] = rag
    return data


ENV_PREFIX = "SHOPMIND__"


def deep_merge(base: dict[str, Any], overlay: dict[str, Any]) -> dict[str, Any]:
    """Recursively merge mappings; lists and scalars in ``overlay`` replace ``base``."""
    merged = dict(base)
    for key, value in overlay.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = deep_merge(merged[key], value)
        else:
            merged[key] = value
    return merged


def _coerce_env(value: str) -> Any:
    try:
        return yaml.safe_load(value)
    except yaml.YAMLError:
        return value


def set_dotted(data: dict[str, Any], dotted: str, value: Any) -> dict[str, Any]:
    """Return a copy of ``data`` with ``a.b.c`` set (intermediate mappings are created)."""
    keys = dotted.split(".")
    root = dict(data)
    node = root
    for key in keys[:-1]:
        child = node.get(key)
        node[key] = dict(child) if isinstance(child, dict) else {}
        node = node[key]
    node[keys[-1]] = value
    return root


def get_dotted(data: Any, dotted: str) -> Any:
    node = data
    for key in dotted.split("."):
        node = node[key] if isinstance(node, dict) else getattr(node, key)
    return node


def _overlay_prefixed_env(data: dict[str, Any], environ: Mapping[str, str]) -> dict[str, Any]:
    """``SHOPMIND__RAG__LLM__MODEL=gpt-x`` → ``rag.llm.model``; values are parsed as YAML scalars."""
    for name, value in sorted(environ.items()):
        if name.startswith(ENV_PREFIX) and value != "":
            data = set_dotted(data, name[len(ENV_PREFIX):].lower().replace("__", "."), _coerce_env(value))
    return data


def apply_overrides(config: AppConfig, overrides: Mapping[str, Any]) -> AppConfig:
    """Runtime (admin) overrides by dotted key; re-validated with the same models."""
    data = config.model_dump()
    for dotted, value in overrides.items():
        data = set_dotted(data, dotted, value)
    return AppConfig.model_validate(data)


def parse_origins(value: str) -> list[str]:
    return [origin.strip() for origin in value.split(",") if origin.strip()]


def _read_yaml(path: Path) -> dict[str, Any]:
    loaded = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    if not isinstance(loaded, dict):
        raise ValueError(f"config root must be a mapping: {path}")
    return loaded


def load_config_data(path: str | Path, profile: str | None = None, environ: Mapping[str, str] | None = None) -> dict[str, Any]:
    """Layering: base YAML (+ ``include:`` files) → ``profiles/<profile>.yaml`` → env vars."""
    environ = os.environ if environ is None else environ
    config_path = Path(path)
    data = _read_yaml(config_path)
    for include in data.pop("include", []) or []:
        data = deep_merge(_read_yaml(config_path.parent / include), data)
    # File references (prompts, vocabularies) are relative to the base config's directory.
    for section in ("prompts", "vocabularies"):
        if isinstance(data.get(section), dict):
            data[section] = {key: str(value if Path(str(value)).is_absolute() else (config_path.parent / str(value)).resolve()) for key, value in data[section].items()}
    profile = profile if profile is not None else environ.get("SHOPMIND_PROFILE") or None
    if profile:
        profile_path = config_path.parent / "profiles" / f"{profile}.yaml"
        if not profile_path.exists():
            raise FileNotFoundError(f"config profile not found: {profile_path}")
        data = deep_merge(data, _read_yaml(profile_path))
    return _overlay_prefixed_env(_overlay_env(data), environ)


def load_app_config(path: str | Path, profile: str | None = None) -> AppConfig:
    return AppConfig.model_validate(load_config_data(path, profile))
