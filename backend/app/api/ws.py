"""
WebSocket endpoint.

Clients connect to /ws/{round_id}?api_key=xxx
They receive all broadcast events for that round, plus personal position_update.
They can also send JSON commands: {"action": "ping"} etc.
"""
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import select

from ..core.session import session_manager
from ..core.ws_manager import ws_manager
from ..db import AsyncSessionLocal
from ..models.db import User

router = APIRouter(tags=["ws"])


@router.websocket("/ws/{round_id}")
async def websocket_endpoint(websocket: WebSocket, round_id: int, api_key: str = ""):
    user_id = None

    if api_key:
        async with AsyncSessionLocal() as db:
            result = await db.execute(select(User).where(User.api_key == api_key))
            user = result.scalar_one_or_none()
            if user:
                user_id = user.id

    await ws_manager.connect(websocket, round_id, user_id)

    # Send initial state
    rt = session_manager.get_round_runtime(round_id)
    if rt:
        for ticker, book in rt.books.items():
            snap = book.snapshot()
            await websocket.send_json({"type": "orderbook_update", "data": snap})
        if user_id:
            positions = rt.get_position_snapshot(user_id)
            await websocket.send_json({"type": "position_update", "data": positions})

    try:
        while True:
            data = await websocket.receive_json()
            if data.get("action") == "ping":
                await websocket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket, round_id)
    except Exception:
        ws_manager.disconnect(websocket, round_id)
