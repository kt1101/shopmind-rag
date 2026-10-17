"""Usage/feedback events (``event_log``), chat history (``chat_store``), synthetic price/stock (``commerce``)."""
from __future__ import annotations

ORDER = 4
CRITICAL = False
LIGHTWEIGHT = True


def wire(container) -> None:
    from shopmind.infrastructure.db.chat_store import ChatStore
    from shopmind.infrastructure.db.commerce import ProductOverlayService
    from shopmind.infrastructure.db.events import EventLog

    db, writer = container.db, container.db_writer
    if container.get("event_log") is None:
        container.provide("event_log", EventLog(db, writer))
    if container.get("chat_store") is None:
        container.provide("chat_store", ChatStore(db, writer))
    if container.get("commerce") is None:
        container.provide("commerce", ProductOverlayService(db, enabled=container.config.features.synthetic_commerce))
