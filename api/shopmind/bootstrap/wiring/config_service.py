"""Runtime config: ``config_service`` = base config + the active admin profile (hot-reloadable keys)."""
from __future__ import annotations

ORDER = 3
CRITICAL = False
LIGHTWEIGHT = True


def wire(container) -> None:
    if container.get("config_service") is not None:
        return
    from shopmind.application.admin.config_service import ConfigService
    from shopmind.infrastructure.db.repositories import ProfileRepository

    container.provide("config_service", ConfigService(container.config, ProfileRepository(container.db)))
