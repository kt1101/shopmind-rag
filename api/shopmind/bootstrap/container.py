"""Composition root.

``build_container(config)`` imports every module in ``shopmind.bootstrap.wiring`` (sorted by
their ``ORDER`` attribute) and calls its ``wire(container)``. Each workstream owns one wiring
module, so adding a subsystem never edits this file or ``main.py``. A failing module records
its exception in ``container.errors[<module>]``; modules with ``CRITICAL = True`` make the
whole runtime unready (``/ready`` → 503) while ``/health`` stays up.
"""
from __future__ import annotations

import importlib
import logging
import pkgutil
from dataclasses import dataclass, field
from typing import Any

from shopmind.core.config import AppConfig
from shopmind.core.registry import load_plugins

logger = logging.getLogger("shopmind.bootstrap")


@dataclass
class Container:
    config: AppConfig
    components: dict[str, Any] = field(default_factory=dict)
    errors: dict[str, BaseException] = field(default_factory=dict)
    critical_errors: dict[str, BaseException] = field(default_factory=dict)

    def __getattr__(self, name: str) -> Any:
        try:
            return self.__dict__["components"][name]
        except KeyError:
            raise AttributeError(name) from None

    def get(self, name: str, default: Any = None) -> Any:
        return self.components.get(name, default)

    def provide(self, name: str, component: Any) -> Any:
        self.components[name] = component
        return component


def wiring_modules() -> list[Any]:
    from shopmind.bootstrap import wiring

    modules = [importlib.import_module(f"{wiring.__name__}.{info.name}") for info in pkgutil.iter_modules(wiring.__path__) if not info.name.startswith("_")]
    return sorted(modules, key=lambda module: (getattr(module, "ORDER", 100), module.__name__))


def build_container(config: AppConfig, *, overrides: dict[str, Any] | None = None, lightweight_only: bool = False) -> Container:
    """Wire every subsystem. ``overrides`` pre-seeds components (tests inject fakes this way).

    ``lightweight_only`` runs only modules with ``LIGHTWEIGHT = True`` (no network, no models),
    which is what ``create_app(auto_wire=False)`` uses.
    """
    load_plugins(config.plugins)
    container = Container(config=config, components=dict(overrides or {}))
    for module in wiring_modules():
        if lightweight_only and not getattr(module, "LIGHTWEIGHT", False):
            continue
        name = module.__name__.rsplit(".", 1)[-1]
        try:
            module.wire(container)
        except Exception as exc:  # keep /health up; surface through /ready and per-feature 503s
            logger.exception("wiring %s failed", name)
            container.errors[name] = exc
            if getattr(module, "CRITICAL", False):
                container.critical_errors[name] = exc
    return container
