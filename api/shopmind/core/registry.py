"""Component registry: config names → implementations.

Every swappable component (embedder, retriever, fuser, reranker, LLM provider, pipeline step,
trace store, …) registers itself under ``(kind, name)``. The composition root
(``shopmind.bootstrap.container``) resolves names that come from YAML, so adding an
implementation never requires editing wiring code:

    @register("fuser", "rrf")
    class RRFFuser: ...

    fuser = create("fuser", config_value, **params)
"""
from __future__ import annotations

import importlib
from collections.abc import Callable
from typing import Any

_REGISTRY: dict[str, dict[str, Any]] = {}


class UnknownComponent(LookupError):
    pass


def register(kind: str, name: str, *, replace: bool = False) -> Callable[[Any], Any]:
    def decorator(target: Any) -> Any:
        bucket = _REGISTRY.setdefault(kind, {})
        if name in bucket and bucket[name] is not target and not replace:
            raise ValueError(f"{kind} {name!r} is already registered")
        bucket[name] = target
        return target

    return decorator


def resolve(kind: str, name: str) -> Any:
    try:
        return _REGISTRY[kind][name]
    except KeyError:
        known = ", ".join(sorted(_REGISTRY.get(kind, {}))) or "none"
        raise UnknownComponent(f"unknown {kind} {name!r} (registered: {known})") from None


def create(kind: str, name: str, /, **params: Any) -> Any:
    return resolve(kind, name)(**params)


def available(kind: str | None = None) -> dict[str, list[str]] | list[str]:
    if kind is not None:
        return sorted(_REGISTRY.get(kind, {}))
    return {key: sorted(value) for key, value in sorted(_REGISTRY.items())}


def load_plugins(modules: list[str]) -> None:
    """Import modules for their ``@register`` side effects (listed in config ``plugins``)."""
    for module in modules:
        importlib.import_module(module)
