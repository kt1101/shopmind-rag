"""FastAPI route modules. Every module exposing ``router`` is mounted automatically
(sorted by optional ``ORDER``), so new endpoints never require editing ``main.py``."""
from __future__ import annotations

import importlib
import pkgutil
from typing import Any


def discover_routers() -> list[Any]:
    modules = [importlib.import_module(f"{__name__}.{info.name}") for info in pkgutil.iter_modules(__path__) if not info.name.startswith("_")]
    modules = [module for module in modules if hasattr(module, "router")]
    return [module.router for module in sorted(modules, key=lambda module: (getattr(module, "ORDER", 100), module.__name__))]
