from __future__ import annotations

from typing import Any

from shopmind.app.core.config import ElasticsearchConfig


def create_elasticsearch_client(config: ElasticsearchConfig) -> Any:
    """Create an Elasticsearch client without leaking the dependency upward."""
    try:
        from elasticsearch import Elasticsearch
    except ImportError as exc:
        raise RuntimeError("elasticsearch Python package is required for runtime search") from exc
    kwargs: dict[str, Any] = {}
    if config.username:
        kwargs["basic_auth"] = (config.username, config.password or "")
    return Elasticsearch(config.url, **kwargs)
