"""Admin authentication (component ``auth_service``): bcrypt password hashes + HS256 JWTs.

``verify(token)`` is what ``interfaces/http/deps.require_auth`` calls. Tokens are only issued
when ``auth.jwt_secret`` is configured (env ``JWT_SECRET``); the secret is never logged.
"""
from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta
from functools import lru_cache
from typing import Any

import bcrypt
import jwt
from sqlalchemy import select

from shopmind.core.config import AuthConfig
from shopmind.infrastructure.db.engine import Database
from shopmind.infrastructure.db.models import User

logger = logging.getLogger("shopmind.auth")

ROLES = ("admin", "annotator")
MIN_SECRET_LENGTH = 16
BCRYPT_ROUNDS = 12  # tests lower this for speed
ISSUER = "shopmind"


class AuthNotConfigured(RuntimeError):
    """No JWT secret configured: tokens cannot be issued or verified."""


class InvalidCredentials(Exception):
    """Unknown user, wrong password or disabled account."""


class InvalidToken(Exception):
    """Bad signature, expired, malformed, or the user no longer exists."""


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8")[:72], bcrypt.gensalt(rounds=BCRYPT_ROUNDS)).decode("ascii")


def check_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8")[:72], hashed.encode("ascii"))
    except ValueError:
        return False


@lru_cache(maxsize=1)
def _dummy_hash() -> str:
    """Checked for unknown users so response time does not reveal which usernames exist."""
    return hash_password("shopmind-dummy-password")


class AuthService:
    def __init__(self, db: Database, config: AuthConfig) -> None:
        self.db = db
        self.config = config
        self.secret = config.jwt_secret or None
        self._bootstrapped = False
        if self.secret and len(self.secret) < MIN_SECRET_LENGTH:
            logger.warning("auth.jwt_secret is shorter than %d characters", MIN_SECRET_LENGTH)

    @property
    def configured(self) -> bool:
        return bool(self.secret)

    # -- users ---------------------------------------------------------------------------------
    def ensure_user(self, username: str, password: str, role: str = "admin", *, update_password: bool = False) -> bool:
        """Create the user if missing. Returns True when a row was created or updated."""
        if role not in ROLES:
            raise ValueError(f"unknown role {role!r}")
        with self.db.session() as session:
            user = session.scalar(select(User).where(User.username == username))
            if user is None:
                session.add(User(username=username, password_hash=hash_password(password), role=role))
                return True
            if update_password and not check_password(password, user.password_hash):
                user.password_hash = hash_password(password)
                return True
            return False

    def ensure_bootstrap_admin(self) -> bool:
        if not self.config.admin_password:
            logger.info("ADMIN_PASSWORD not set: no bootstrap admin account created")
            return False
        created = self.ensure_user(self.config.admin_username, self.config.admin_password, "admin")
        self._bootstrapped = True
        if created:
            logger.info("bootstrap admin account %r created", self.config.admin_username)
        return created

    def authenticate(self, username: str, password: str) -> dict[str, Any]:
        with self.db.session() as session:
            user = session.scalar(select(User).where(User.username == username))
            if user is None or not user.active:
                check_password(password, _dummy_hash())
                raise InvalidCredentials("invalid username or password")
            if not check_password(password, user.password_hash):
                raise InvalidCredentials("invalid username or password")
            user.last_login_at = datetime.now(UTC)
            return {"username": user.username, "role": user.role}

    def get_user(self, username: str) -> dict[str, Any] | None:
        with self.db.session() as session:
            user = session.scalar(select(User).where(User.username == username))
            return None if user is None or not user.active else {"username": user.username, "role": user.role}

    # -- tokens --------------------------------------------------------------------------------
    @property
    def ttl_seconds(self) -> int:
        return int(self.config.token_ttl_minutes * 60)

    def issue(self, user: dict[str, Any], *, now: datetime | None = None) -> dict[str, Any]:
        if not self.secret:
            raise AuthNotConfigured("JWT_SECRET is not configured; admin login is disabled")
        now = now or datetime.now(UTC)
        claims = {"sub": user["username"], "role": user["role"], "iat": int(now.timestamp()), "exp": int((now + timedelta(seconds=self.ttl_seconds)).timestamp()), "iss": ISSUER}
        token = jwt.encode(claims, self.secret, algorithm=self.config.jwt_algorithm)
        return {"access_token": token, "token_type": "bearer", "expires_in": self.ttl_seconds, "user": {"username": user["username"], "role": user["role"]}}

    def login(self, username: str, password: str) -> dict[str, Any]:
        if not self.secret:
            raise AuthNotConfigured("JWT_SECRET is not configured; admin login is disabled")
        if not self._bootstrapped:  # the database may have been down when the app started
            self._bootstrapped = True
            try:
                self.ensure_bootstrap_admin()
            except Exception:
                self._bootstrapped = False
                raise
        return self.issue(self.authenticate(username, password))

    def verify(self, token: str) -> dict[str, Any]:
        if not self.secret:
            raise AuthNotConfigured("JWT_SECRET is not configured")
        try:
            claims = jwt.decode(token, self.secret, algorithms=[self.config.jwt_algorithm], issuer=ISSUER, options={"require": ["exp", "sub"]})
        except jwt.PyJWTError as exc:
            raise InvalidToken(type(exc).__name__) from exc
        if claims.get("role") not in ROLES:
            raise InvalidToken("unknown role")
        # The token is only proof of a login: the account must still exist and be active, and the
        # current role (not the one at login time) is what counts.
        try:
            user = self.get_user(str(claims["sub"]))
        except Exception:  # database down: fall back to the signed claims
            return {"username": str(claims["sub"]), "role": claims["role"]}
        if user is None:
            raise InvalidToken("user no longer exists or is inactive")
        return {"username": user["username"], "role": user["role"]}
