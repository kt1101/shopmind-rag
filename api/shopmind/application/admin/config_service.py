"""Runtime config (component ``config_service``): base AppConfig + the active admin profile.

``effective()`` is what ``interfaces/http/deps.get_config`` serves to every request. Profiles are
complete override sets (dotted key → value) restricted to ``config.hot_reloadable``; saving one
validates the merged result with the same Pydantic models before activating it, and activating
an older profile is the rollback. Subscribers (``subscribe(callback)``) are called with the new
effective config whenever it changes.
"""
from __future__ import annotations

import logging
import threading
import time
from collections.abc import Callable, Mapping
from typing import Any, Protocol

from pydantic import ValidationError

from shopmind.application.admin.config_rules import apply_dotted, expand_hot_reloadable, field_spec, flatten, is_hot_reloadable, redact, resolve_path, validation_details
from shopmind.core.config import AppConfig

logger = logging.getLogger("shopmind.config")

Subscriber = Callable[[AppConfig], None]


class ProfileStore(Protocol):
    def list(self) -> list[dict[str, Any]]: ...
    def active(self) -> dict[str, Any] | None: ...
    def get(self, profile_id: int) -> dict[str, Any] | None: ...
    def create(self, name: str, overrides: dict[str, Any], created_by: str | None, *, activate: bool = True) -> dict[str, Any]: ...
    def activate(self, profile_id: int) -> dict[str, Any] | None: ...


class ConfigValidationError(ValueError):
    def __init__(self, message: str, details: list[dict[str, str]]) -> None:
        super().__init__(message)
        self.details = details


class ProfileNotFound(LookupError):
    pass


class ConfigService:
    def __init__(self, base: AppConfig, store: ProfileStore | None = None, *, refresh_seconds: float = 10.0) -> None:
        self.base = base
        self.store = store
        self.refresh_seconds = refresh_seconds
        self._lock = threading.RLock()
        self._effective: AppConfig | None = None
        self._active: dict[str, Any] | None = None
        self._checked_at = 0.0
        self._stale = False
        self._subscribers: list[Subscriber] = []

    # -- hot-reloadable keys ----------------------------------------------------------------------
    @property
    def patterns(self) -> list[str]:
        return list(self.base.hot_reloadable)

    def hot_reloadable_keys(self, config: AppConfig | None = None) -> list[str]:
        return expand_hot_reloadable((config or self.effective()).model_dump(mode="json"), self.patterns)

    def hot_reloadable_specs(self, config: AppConfig | None = None) -> list[dict[str, Any]]:
        config = config or self.effective()
        data = config.model_dump(mode="json")
        flat = flatten(data)
        return [{"key": key, **field_spec(AppConfig, resolve_path(data, key), flat.get(key))} for key in expand_hot_reloadable(data, self.patterns)]

    # -- effective config ---------------------------------------------------------------------------
    def build(self, overrides: Mapping[str, Any]) -> AppConfig:
        """Validate ``overrides`` (dotted keys) on top of the base config; raises ``ConfigValidationError``."""
        details = [{"field": key, "message": "Key is not hot-reloadable"} for key in overrides if not is_hot_reloadable(key, self.patterns)]
        allowed = {key: value for key, value in overrides.items() if is_hot_reloadable(key, self.patterns)}
        config = None
        try:
            data = apply_dotted(self.base.model_dump(), allowed)
            config = AppConfig.model_validate(data)
        except ValidationError as exc:
            details.extend(validation_details(exc, allowed.keys()))
        except ValueError as exc:
            details.append({"field": "overrides", "message": str(exc)})
        if details or config is None:
            raise ConfigValidationError("config validation failed", details)
        return config

    def _load_active(self) -> dict[str, Any] | None:
        if self.store is None:
            return None
        try:
            return self.store.active()
        except Exception as exc:
            logger.warning("could not read the active config profile: %s", exc)
            return self._active

    def effective(self) -> AppConfig:
        now = time.monotonic()
        with self._lock:
            if self._effective is not None and not self._stale and now - self._checked_at < self.refresh_seconds:
                return self._effective
            self._checked_at = now
            stale, self._stale = self._stale, False
            active = self._load_active()
            if self._effective is not None and not stale and _same_profile(active, self._active):
                return self._effective
            previous = self._effective
            self._effective = self._compute(active)
            self._active = active
            config = self._effective
        if previous is not None and previous != config:
            self._notify(config)
        return config

    def _compute(self, active: dict[str, Any] | None) -> AppConfig:
        if not active or not active.get("overrides"):
            return self.base
        try:
            return self.build(active["overrides"])
        except ConfigValidationError as exc:
            logger.error("active config profile %s is invalid for the current base config, using base: %s", active.get("id"), exc.details)
            return self.base

    def invalidate(self) -> None:
        with self._lock:
            self._stale = True

    def active_profile(self) -> dict[str, Any] | None:
        self.effective()
        return self._active

    # -- profiles ----------------------------------------------------------------------------------
    def _require_store(self) -> ProfileStore:
        if self.store is None:
            raise RuntimeError("config profiles need the database")
        return self.store

    def list_profiles(self) -> list[dict[str, Any]]:
        return self._require_store().list()

    def save_profile(self, name: str, overrides: Mapping[str, Any], created_by: str | None = None, *, merge_active: bool = True) -> dict[str, Any]:
        name = (name or "").strip()
        details = [] if name else [{"field": "name", "message": "Profile name is required"}]
        base_overrides = dict((self.active_profile() or {}).get("overrides") or {}) if merge_active else {}
        merged = {**base_overrides, **dict(overrides)}
        try:
            self.build(merged)
        except ConfigValidationError as exc:
            details.extend(exc.details)
        if details:
            raise ConfigValidationError("config validation failed", details)
        self.ensure_baseline()
        profile = self._require_store().create(name[:128], merged, created_by, activate=True)
        self.invalidate()
        self.effective()
        return profile

    def activate(self, profile_id: int) -> dict[str, Any]:
        store = self._require_store()
        profile = store.get(profile_id)
        if profile is None:
            raise ProfileNotFound(f"config profile {profile_id} not found")
        self.build(profile.get("overrides") or {})  # refuse to activate a profile that no longer validates
        activated = store.activate(profile_id)
        if activated is None:
            raise ProfileNotFound(f"config profile {profile_id} not found")
        self.invalidate()
        self.effective()
        return activated

    def ensure_baseline(self, created_by: str = "system") -> None:
        """Create an empty ``baseline`` profile on first run so there is always something to roll back to."""
        store = self._require_store()
        if not store.list():
            store.create("baseline", {}, created_by, activate=True)
            self.invalidate()

    # -- subscribers -------------------------------------------------------------------------------
    def subscribe(self, callback: Subscriber) -> Callable[[], None]:
        with self._lock:
            self._subscribers.append(callback)

        def unsubscribe() -> None:
            with self._lock:
                if callback in self._subscribers:
                    self._subscribers.remove(callback)

        return unsubscribe

    def _notify(self, config: AppConfig) -> None:
        for callback in list(self._subscribers):
            try:
                callback(config)
            except Exception:
                logger.exception("config subscriber failed")

    # -- presentation ------------------------------------------------------------------------------
    def redacted(self, config: AppConfig | None = None) -> dict[str, Any]:
        return redact((config or self.effective()).model_dump(mode="json"))


def _same_profile(left: dict[str, Any] | None, right: dict[str, Any] | None) -> bool:
    if left is None or right is None:
        return left is right
    return left.get("id") == right.get("id") and left.get("overrides") == right.get("overrides")
