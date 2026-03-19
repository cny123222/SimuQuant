"""
Centralised trade handler that wires order book callbacks to DB persistence
and WebSocket broadcasting.  Created once per Round when it goes ACTIVE.
"""
from __future__ import annotations

import asyncio
from datetime import datetime

from ..db import AsyncSessionLocal
from ..models.db import Trade
from .engine import TradeRecord, LimitOrderBook
from .session import RoundRuntime
from .ws_manager import ws_manager


class TradeHandler:
    """Attaches a single callback per book that handles all trades in a round."""

    def __init__(self, round_id: int, rt: RoundRuntime):
        self.round_id = round_id
        self.rt = rt

    def attach_to_books(self) -> None:
        for ticker, book in self.rt.books.items():
            book.add_trade_callback(self._make_callback(book))

    def _make_callback(self, book: LimitOrderBook):
        round_id = self.round_id
        rt = self.rt

        async def on_trade(trade: TradeRecord) -> None:
            # 1. update in-memory positions
            if trade.buyer_user_id is not None:
                rt.apply_trade_to_position(
                    trade.buyer_user_id, trade.ticker, "BUY", trade.price, trade.quantity
                )
            if trade.seller_user_id is not None:
                rt.apply_trade_to_position(
                    trade.seller_user_id, trade.ticker, "SELL", trade.price, trade.quantity
                )

            # 2. persist trade to DB
            async with AsyncSessionLocal() as db:
                t = Trade(
                    round_id=round_id,
                    ticker=trade.ticker,
                    price=trade.price,
                    quantity=trade.quantity,
                    buyer_order_id=trade.buyer_order_id,
                    seller_order_id=trade.seller_order_id,
                    aggressor_side=trade.aggressor_side,
                    executed_at=datetime.utcnow(),
                )
                db.add(t)
                await db.commit()

            # 3. broadcast public trade event
            await ws_manager.broadcast(round_id, "trade", {
                "ticker": trade.ticker,
                "price": trade.price,
                "quantity": trade.quantity,
                "aggressor_side": trade.aggressor_side,
                "executed_at": trade.executed_at.isoformat(),
            })

            # 4. push personal position update to each involved user
            for uid in {trade.buyer_user_id, trade.seller_user_id}:
                if uid is not None:
                    positions = rt.get_position_snapshot(uid)
                    await ws_manager.send_to_user(round_id, uid, "position_update", positions)

        return on_trade
