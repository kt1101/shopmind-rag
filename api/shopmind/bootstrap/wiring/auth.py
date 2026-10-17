"""Admin authentication: ``auth_service`` (bcrypt + HS256 JWT) and the bootstrap admin account."""
from __future__ import annotations

import logging

ORDER = 2
CRITICAL = False
LIGHTWEIGHT = True

logger = logging.getLogger("shopmind.bootstrap.auth")


def wire(container) -> None:
    if container.get("auth_service") is not None:
        return
    from shopmind.infrastructure.auth import AuthService

    config = container.config.auth
    service = container.provide("auth_service", AuthService(container.db, config))
    if config.enabled and not service.configured:
        logger.warning("auth.enabled is true but JWT_SECRET is not set: admin endpoints will answer 401")
    if config.admin_password:
        try:
            service.ensure_bootstrap_admin()
        except Exception as exc:  # database down: retried on the first login
            logger.warning("bootstrap admin not ensured yet: %s", exc)
