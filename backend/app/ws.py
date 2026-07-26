from __future__ import annotations

import asyncio
import json
from collections import defaultdict
from typing import Any

from fastapi import WebSocket


class EventBus:
    def __init__(self) -> None:
        self._subs: dict[str, set[WebSocket]] = defaultdict(set)
        self._lock = asyncio.Lock()

    async def subscribe(self, session_id: str, ws: WebSocket) -> None:
        async with self._lock:
            self._subs[session_id].add(ws)

    async def unsubscribe(self, session_id: str, ws: WebSocket) -> None:
        async with self._lock:
            self._subs[session_id].discard(ws)
            if not self._subs[session_id]:
                del self._subs[session_id]

    async def publish(self, session_id: str, event: dict[str, Any]) -> None:
        async with self._lock:
            sockets = list(self._subs.get(session_id, set()))
        dead: list[WebSocket] = []
        data = json.dumps(event, default=str)
        for ws in sockets:
            try:
                await ws.send_text(data)
            except Exception:
                dead.append(ws)
        for ws in dead:
            await self.unsubscribe(session_id, ws)


bus = EventBus()
