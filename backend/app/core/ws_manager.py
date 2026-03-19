"""
WebSocket connection manager.

Clients subscribe to a round_id channel.  The manager broadcasts typed events
to all subscribers in that channel, and optionally to a single user_id.
"""
from __future__ import annotations

import asyncio
import json
from collections import defaultdict
from typing import Any, Optional

from fastapi import WebSocket


class ConnectionManager:
    def __init__(self):
        # round_id → list of (websocket, user_id)
        self._channels: dict[int, list[tuple[WebSocket, Optional[int]]]] = defaultdict(list)

    async def connect(self, ws: WebSocket, round_id: int, user_id: Optional[int] = None) -> None:
        await ws.accept()
        self._channels[round_id].append((ws, user_id))

    def disconnect(self, ws: WebSocket, round_id: int) -> None:
        self._channels[round_id] = [
            (w, u) for w, u in self._channels[round_id] if w is not ws
        ]

    async def broadcast(self, round_id: int, event_type: str, data: Any) -> None:
        payload = json.dumps({"type": event_type, "data": data})
        dead: list[WebSocket] = []
        for ws, _ in list(self._channels.get(round_id, [])):
            try:
                await ws.send_text(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws, round_id)

    async def send_to_user(
        self, round_id: int, user_id: int, event_type: str, data: Any
    ) -> None:
        payload = json.dumps({"type": event_type, "data": data})
        dead: list[WebSocket] = []
        for ws, uid in list(self._channels.get(round_id, [])):
            if uid == user_id:
                try:
                    await ws.send_text(payload)
                except Exception:
                    dead.append(ws)
        for ws in dead:
            self.disconnect(ws, round_id)

    def subscriber_count(self, round_id: int) -> int:
        return len(self._channels.get(round_id, []))


ws_manager = ConnectionManager()
