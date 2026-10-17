"""Pure helpers for runtime (admin) config overrides.

Dotted keys address the merged config. Some mapping keys contain dots themselves (pipeline names
such as ``search.hybrid``), so a dotted key is resolved against the actual data greedily
(longest existing key first): ``pipelines.search.hybrid.steps`` → ``["pipelines", "search.hybrid",
"steps"]``.

``hot_reloadable`` patterns: ``a.b`` allows ``a.b`` and anything below it, ``*`` matches one or
more key segments (``pipelines.*.steps``, ``rag.fusion.*``).
"""
from __future__ import annotations

import re
import types
import typing
from collections.abc import Iterable, Mapping
from typing import Any, Literal

from pydantic import BaseModel, ValidationError

REDACTED = "***"
SECRET_KEYS = {"api_key", "jwt_secret", "password", "admin_password", "hf_token", "secret", "access_token", "token"}
SECRET_SUFFIXES = ("_api_key", "_password", "_secret", "_token")
_URL_CREDENTIALS = re.compile(r"(?P<scheme>[a-z][a-z0-9+.-]*://)(?P<user>[^:/@\s]+):(?P<password>[^@\s]+)@", re.IGNORECASE)


# -- paths ----------------------------------------------------------------------------------------
def resolve_path(data: Any, dotted: str) -> list[str]:
    tokens = [token for token in dotted.split(".")]
    if not dotted or any(token == "" for token in tokens):
        raise ValueError(f"invalid config key {dotted!r}")
    path: list[str] = []
    node = data
    index = 0
    while index < len(tokens):
        chosen = None
        if isinstance(node, Mapping):
            for end in range(len(tokens), index, -1):
                candidate = ".".join(tokens[index:end])
                if candidate in node:
                    chosen = (candidate, end)
                    break
        if chosen is None:
            chosen = (tokens[index], index + 1)
        key, index = chosen
        path.append(key)
        node = node.get(key) if isinstance(node, Mapping) else None
    return path


def set_path(data: dict[str, Any], path: list[str], value: Any) -> dict[str, Any]:
    root = dict(data)
    node = root
    for key in path[:-1]:
        child = node.get(key)
        node[key] = dict(child) if isinstance(child, Mapping) else {}
        node = node[key]
    node[path[-1]] = value
    return root


def get_path(data: Any, path: list[str]) -> Any:
    node = data
    for key in path:
        if not isinstance(node, Mapping) or key not in node:
            raise KeyError(".".join(path))
        node = node[key]
    return node


def apply_dotted(data: dict[str, Any], overrides: Mapping[str, Any]) -> dict[str, Any]:
    for dotted, value in overrides.items():
        data = set_path(data, resolve_path(data, dotted), value)
    return data


def flatten(data: Any, prefix: str = "") -> dict[str, Any]:
    """Same convention as the admin UI: nested mappings are walked, lists/scalars/empty maps are leaves."""
    out: dict[str, Any] = {}
    if not isinstance(data, Mapping):
        if prefix:
            out[prefix] = data
        return out
    if not data and prefix:
        out[prefix] = {}
        return out
    for key, value in data.items():
        path = f"{prefix}.{key}" if prefix else str(key)
        if isinstance(value, Mapping) and value:
            out.update(flatten(value, path))
        else:
            out[path] = value
    return out


# -- hot-reload patterns --------------------------------------------------------------------------
def _pattern_regex(pattern: str) -> re.Pattern[str]:
    parts = [".+" if part == "*" else re.escape(part) for part in pattern.split(".")]
    return re.compile("^" + r"\.".join(parts) + r"(?:\..+)?$")


def is_hot_reloadable(key: str, patterns: Iterable[str]) -> bool:
    return any(_pattern_regex(pattern).match(key) for pattern in patterns if pattern)


def expand_hot_reloadable(data: Mapping[str, Any], patterns: Iterable[str]) -> list[str]:
    patterns = list(patterns)
    return [key for key in flatten(data) if is_hot_reloadable(key, patterns)]


# -- validation -----------------------------------------------------------------------------------
def _loc_to_key(loc: Iterable[Any]) -> str:
    return ".".join(str(part) for part in loc)


def validation_details(exc: ValidationError, keys: Iterable[str]) -> list[dict[str, str]]:
    """Map Pydantic errors to ``[{field, message}]`` using the override key that owns each error."""
    keys = sorted(keys, key=len, reverse=True)
    details = []
    for error in exc.errors():
        location = _loc_to_key(error.get("loc", ()))
        field = next((key for key in keys if location == key or location.startswith(key + ".")), None)
        if field is None:
            field = next((key for key in keys if key.startswith(location + ".") or key == location), location)
        message = str(error.get("msg", "invalid value"))
        if error.get("type") == "extra_forbidden":
            message = "Unknown config key"
        details.append({"field": field, "message": message})
    return details


# -- redaction ------------------------------------------------------------------------------------
def _is_secret_key(name: str) -> bool:
    lowered = name.lower()
    return lowered in SECRET_KEYS or lowered.endswith(SECRET_SUFFIXES)


def redact(value: Any) -> Any:
    """Replace secret values (keys like ``api_key``, ``jwt_secret``, ``*_password``) and URL credentials."""
    if isinstance(value, Mapping):
        return {key: (REDACTED if _is_secret_key(str(key)) and item not in (None, "") else redact(item)) for key, item in value.items()}
    if isinstance(value, list):
        return [redact(item) for item in value]
    if isinstance(value, str) and "://" in value and "@" in value:
        return _URL_CREDENTIALS.sub(lambda match: f"{match['scheme']}{match['user']}:{REDACTED}@", value)
    return value


# -- UI hints -------------------------------------------------------------------------------------
def _unwrap(annotation: Any) -> Any:
    origin = typing.get_origin(annotation)
    if origin in (typing.Union, types.UnionType):
        args = [arg for arg in typing.get_args(annotation) if arg is not type(None)]
        return _unwrap(args[0]) if len(args) == 1 else annotation
    return annotation


def field_spec(model: type[BaseModel], path: list[str], value: Any = None) -> dict[str, Any]:
    """Best-effort input hint for one key: ``{type, options?, min?, max?}``."""
    current: Any = model
    field = None
    for key in path:
        if isinstance(current, type) and issubclass(current, BaseModel) and key in current.model_fields:
            field = current.model_fields[key]
            current = _unwrap(field.annotation)
        else:
            field = None
            break
    spec: dict[str, Any] = {}
    annotation = current if field is not None else None
    if annotation is not None and typing.get_origin(annotation) is Literal:
        spec = {"type": "enum", "options": [str(option) for option in typing.get_args(annotation)]}
    elif annotation is bool or isinstance(value, bool):
        spec = {"type": "boolean"}
    elif annotation is int or (annotation is None and isinstance(value, int)):
        spec = {"type": "integer"}
    elif annotation is float or isinstance(value, float):
        spec = {"type": "number"}
    elif annotation is str or isinstance(value, str):
        spec = {"type": "string"}
    else:
        spec = {"type": "json"}
    if field is not None and spec["type"] in {"integer", "number"}:
        for item in field.metadata:
            for attr, key, inclusive in (("ge", "min", True), ("gt", "min", False), ("le", "max", True), ("lt", "max", False)):
                bound = getattr(item, attr, None)
                if bound is not None:
                    spec[key] = bound if inclusive or spec["type"] == "number" else (bound + 1 if key == "min" else bound - 1)
    return spec
