"""
Centralised trade handler that wires order book callbacks to DB persistence
and WebSocket broadcasting.  Created once per Round when it goes ACTIVE.
"""
from __future__ import annotations

import asyncio
import re
from datetime import datetime

from ..db import AsyncSessionLocal
from ..models.db import Trade
from .engine import TradeRecord, LimitOrderBook
from .session import RoundRuntime
from .ws_manager import ws_manager


def _fmt_label(bot_id: str | None, user_id: int | None) -> str:
    """
    Format a participant label for the WS trade event.

    Bot IDs follow the pattern  "<type>-<index>-<TICKER>"
      "mm-0-SJTU-A"     → "Robot-MM-1"
      "noise-2-SJTU-B"  → "Robot-N-3"
    Users show as "User-{id}" (avoids extra DB query).
    Unknown participants show as "-".
    """
    if bot_id:
        # Strip the trailing "-TICKER" suffix (everything after the second dash-group)
        # Pattern: (type)-(index)-(ticker...)
        m = re.match(r'^(mm|noise)-(\d+)-', bot_id)
        if m:
            kind = "MM" if m.group(1) == "mm" else "N"
            idx = int(m.group(2)) + 1   # 0-indexed → 1-indexed
            return f"Robot-{kind}-{idx}"
        return f"Robot({bot_id})"
    if user_id is not None:
        return f"User-{user_id}"
    return "-"


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

            # 3. broadcast public trade event (includes buyer/seller labels)
            buyer_label = _fmt_label(trade.buyer_bot_id, trade.buyer_user_id)
            seller_label = _fmt_label(trade.seller_bot_id, trade.seller_user_id)

            await ws_manager.broadcast(round_id, "trade", {
                "ticker": trade.ticker,
                "price": trade.price,
                "quantity": trade.quantity,
                "aggressor_side": trade.aggressor_side,
                "buyer_label": buyer_label,
                "seller_label": seller_label,
                "executed_at": trade.executed_at.isoformat(),
            })

            # 4. push personal position update to each involved user
            for uid in {trade.buyer_user_id, trade.seller_user_id}:
                if uid is not None:
                    positions = rt.get_position_snapshot(uid)
                    await ws_manager.send_to_user(round_id, uid, "position_update", positions)

        return on_trade
