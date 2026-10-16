from __future__ import annotations

import json
import logging
import sys
from typing import Any, TextIO

_BANNED_KEYS = {"vector", "vectors", "image_bytes", "raw_image", "embedding_vector"}
_HANDLER_NAME = "shopmind-stdout"


def configure_logging(level: int = logging.INFO, stream: TextIO | None = None) -> None:
    # uvicorn configures only its own loggers, so shopmind.* INFO events would otherwise be dropped.
    logger = logging.getLogger("shopmind")
    logger.setLevel(level)
    if any(handler.get_name() == _HANDLER_NAME for handler in logger.handlers):
        return
    handler = logging.StreamHandler(stream or sys.stdout)
    handler.set_name(_HANDLER_NAME)
    handler.setFormatter(logging.Formatter("%(levelname)s:     %(name)s %(message)s"))
    logger.addHandler(handler)


def log_search_event(logger: logging.Logger, **fields: Any) -> None:
    safe: dict[str, Any] = {}
    for key, value in fields.items():
        lowered = key.lower()
        if lowered in _BANNED_KEYS or "vector" in lowered or "image_bytes" in lowered:
            continue
        if value is None or isinstance(value, (str, int, float, bool)):
            safe[key] = value
        elif isinstance(value, (list, tuple)) and all(item is None or isinstance(item, (str, int, float, bool)) for item in value):
            safe[key] = list(value)
        else:
            safe[key] = str(value)
    logger.info(json.dumps(safe, ensure_ascii=False, sort_keys=True))
