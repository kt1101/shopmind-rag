"""Short-lived uploaded chat images (``POST /chat/image`` → ``image_token``).

Images stay in process memory only (never written to disk, logs or traces) and expire after
``features.chat_image_ttl_seconds``. A bounded LRU keeps memory flat under load.
"""
from __future__ import annotations

import secrets
import threading
import time
from collections import OrderedDict
from typing import Any


class ImageTokenCache:
    def __init__(self, ttl_seconds: int = 900, capacity: int = 200, clock=time.monotonic) -> None:
        self.ttl_seconds = ttl_seconds
        self.capacity = capacity
        self.clock = clock
        self._items: OrderedDict[str, tuple[float, Any]] = OrderedDict()
        self._lock = threading.Lock()

    def put(self, image: Any) -> str:
        token = secrets.token_urlsafe(18)
        with self._lock:
            self._items[token] = (self.clock() + self.ttl_seconds, image)
            while len(self._items) > self.capacity:
                self._items.popitem(last=False)
        return token

    def get(self, token: str) -> Any | None:
        with self._lock:
            item = self._items.get(token)
            if item is None:
                return None
            expires, image = item
            if expires < self.clock():
                del self._items[token]
                return None
            self._items.move_to_end(token)
            return image
