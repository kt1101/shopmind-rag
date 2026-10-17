"""Chat history (component ``chat_store``): ``append`` never blocks a request, ``get`` reads back.

``extra`` carries optional per-message data such as ``sources``, ``products``, ``intent`` or
``trace_id``; it is merged into the message dict returned by ``get``. Vectors and image bytes
must not be passed in ``extra`` (they are dropped defensively).
"""
from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select

from shopmind.core.tracing import sanitize
from shopmind.infrastructure.db.engine import Database, DatabaseUnavailable, iso
from shopmind.infrastructure.db.models import ChatMessage, ChatSession
from shopmind.infrastructure.db.writer import BackgroundWriter

logger = logging.getLogger("shopmind.db.chat")

MAX_CONTENT_CHARS = 20000
ROLES = {"user", "assistant", "system"}


class ChatStore:
    def __init__(self, db: Database, writer: BackgroundWriter, *, max_messages: int = 200) -> None:
        self.db = db
        self.writer = writer
        self.max_messages = max_messages

    def append(self, session_id: str, role: str, content: str, extra: dict[str, Any] | None = None) -> bool:
        if not session_id:
            return False
        session_id = str(session_id)[:64]
        role = role if role in ROLES else "assistant"
        text = str(content or "")[:MAX_CONTENT_CHARS]
        payload = sanitize(extra) if extra else None
        created = datetime.now(UTC)

        def write(session) -> None:
            chat = session.get(ChatSession, session_id)
            if chat is None:
                session.add(ChatSession(id=session_id, created_at=created, updated_at=created))
                session.flush()
            else:
                chat.updated_at = created
            session.add(ChatMessage(session_id=session_id, role=role, content=text, extra=payload or None, created_at=created))

        return self.writer.submit(write)

    def get(self, session_id: str) -> list[dict[str, Any]]:
        self.writer.flush(timeout=2.0)
        try:
            with self.db.session() as session:
                rows = session.scalars(select(ChatMessage).where(ChatMessage.session_id == str(session_id)[:64]).order_by(ChatMessage.id.desc()).limit(self.max_messages)).all()
                return [{**(row.extra or {}), "role": row.role, "content": row.content, "created_at": iso(row.created_at)} for row in reversed(rows)]
        except DatabaseUnavailable as exc:
            logger.warning("chat history unavailable: %s", exc)
            return []

    def exists(self, session_id: str) -> bool:
        self.writer.flush(timeout=2.0)
        try:
            with self.db.session() as session:
                return session.get(ChatSession, str(session_id)[:64]) is not None
        except DatabaseUnavailable:
            return False
