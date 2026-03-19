"""
Limit Order Book – price-time priority matching engine.

Each ticker has its own LimitOrderBook instance.
Thread-safety: all operations are protected by an asyncio.Lock so they can be
called from multiple coroutines safely.
"""
from __future__ import annotations

import asyncio
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime
from typing import TYPE_CHECKING, Callable, Coroutine, Optional

from sortedcontainers import SortedDict

if TYPE_CHECKING:
    pass


@dataclass
class BookOrder:
    order_id: int
    user_id: Optional[int]   # None = bot
    bot_id: Optional[str]
    side: str                 # "BUY" | "SELL"
    order_type: str           # "LIMIT" | "MARKET"
    price: Optional[float]
    quantity: int
    filled: int = 0
    created_at: datetime = field(default_factory=datetime.utcnow)

    @property
    def remaining(self) -> int:
        return self.quantity - self.filled

    @property
    def is_done(self) -> bool:
        return self.filled >= self.quantity


@dataclass
class MatchResult:
    """Returned by process_order() after matching."""
    order: BookOrder
    trades: list["TradeRecord"]
    order_status: str  # "OPEN" | "PARTIAL" | "FILLED" | "CANCELLED"


@dataclass
class TradeRecord:
    ticker: str
    price: float
    quantity: int
    buyer_order_id: int
    seller_order_id: int
    aggressor_side: str
    buyer_user_id: Optional[int]
    seller_user_id: Optional[int]
    executed_at: datetime = field(default_factory=datetime.utcnow)


class LimitOrderBook:
    """
    A single-ticker order book.

    Bids stored in a SortedDict keyed by (-price) so iteration gives best bid first.
    Asks stored in a SortedDict keyed by (+price) so iteration gives best ask first.
    Each price level is a deque of BookOrder (FIFO).
    """

    def __init__(self, ticker: str):
        self.ticker = ticker
        self._lock = asyncio.Lock()

        # SortedDict[price_key → deque[BookOrder]]
        self._bids: SortedDict = SortedDict()   # key = -price (ascending → best bid first)
        self._asks: SortedDict = SortedDict()   # key = +price (ascending → best ask first)

        self._orders: dict[int, BookOrder] = {}
        self._last_trade_price: Optional[float] = None

        # Callbacks (coroutines) called after each trade
        self._trade_callbacks: list[Callable[[TradeRecord], Coroutine]] = []

    # ── Public helpers ────────────────────────────────────────────────────────

    def add_trade_callback(self, cb: Callable[[TradeRecord], Coroutine]) -> None:
        self._trade_callbacks.append(cb)

    @property
    def last_price(self) -> Optional[float]:
        return self._last_trade_price

    def best_bid(self) -> Optional[float]:
        if not self._bids:
            return None
        key = self._bids.keys()[0]
        return -key

    def best_ask(self) -> Optional[float]:
        if not self._asks:
            return None
        return self._asks.keys()[0]

    def mid_price(self) -> Optional[float]:
        bb, ba = self.best_bid(), self.best_ask()
        if bb is not None and ba is not None:
            return (bb + ba) / 2
        return self._last_trade_price

    def snapshot(self, depth: int = 5) -> dict:
        """Return top-N bid/ask levels."""
        bids = []
        for key in list(self._bids.keys())[:depth]:
            q = sum(o.remaining for o in self._bids[key])
            bids.append({"price": round(-key, 4), "quantity": q})

        asks = []
        for key in list(self._asks.keys())[:depth]:
            q = sum(o.remaining for o in self._asks[key])
            asks.append({"price": round(key, 4), "quantity": q})

        return {
            "ticker": self.ticker,
            "bids": bids,
            "asks": asks,
            "last_price": self._last_trade_price,
            "timestamp": datetime.utcnow().isoformat(),
        }

    # ── Order management ──────────────────────────────────────────────────────

    async def process_order(self, order: BookOrder) -> MatchResult:
        async with self._lock:
            trades: list[TradeRecord] = []

            if order.order_type == "MARKET":
                trades = await self._match_market(order)
            else:
                trades = await self._match_limit(order)

            if trades:
                self._last_trade_price = trades[-1].price

            if order.is_done:
                status = "FILLED"
            elif order.filled > 0:
                status = "PARTIAL"
                self._add_to_book(order)
            else:
                if order.order_type == "LIMIT":
                    self._add_to_book(order)
                    status = "OPEN"
                else:
                    status = "CANCELLED"  # market order with no fill

            self._orders[order.order_id] = order

        for t in trades:
            for cb in self._trade_callbacks:
                asyncio.create_task(cb(t))

        return MatchResult(order=order, trades=trades, order_status=status)

    async def cancel_order(self, order_id: int) -> bool:
        async with self._lock:
            order = self._orders.get(order_id)
            if order is None or order.is_done:
                return False
            self._remove_from_book(order)
            return True

    # ── Matching logic ────────────────────────────────────────────────────────

    async def _match_market(self, aggressor: BookOrder) -> list[TradeRecord]:
        trades: list[TradeRecord] = []
        opposite = self._asks if aggressor.side == "BUY" else self._bids

        while aggressor.remaining > 0 and opposite:
            best_key = opposite.keys()[0]
            level: deque[BookOrder] = opposite[best_key]
            # Asks stored as +price, bids as -price
            exec_price = best_key if aggressor.side == "BUY" else -best_key

            while level and aggressor.remaining > 0:
                passive = level[0]
                qty = min(aggressor.remaining, passive.remaining)
                aggressor.filled += qty
                passive.filled += qty

                trade = self._make_trade(aggressor, passive, exec_price, qty)
                trades.append(trade)

                if passive.is_done:
                    level.popleft()

            if not level:
                del opposite[best_key]

        return trades

    async def _match_limit(self, aggressor: BookOrder) -> list[TradeRecord]:
        trades: list[TradeRecord] = []

        if aggressor.side == "BUY":
            opposite = self._asks
            price_ok = lambda key: key <= aggressor.price  # type: ignore[operator]
        else:
            opposite = self._bids
            price_ok = lambda key: (-key) >= aggressor.price  # type: ignore[operator]

        while aggressor.remaining > 0 and opposite:
            best_key = opposite.keys()[0]
            if not price_ok(best_key):
                break

            # Asks stored as +price, bids as -price
            exec_price = best_key if aggressor.side == "BUY" else -best_key
            level: deque[BookOrder] = opposite[best_key]

            while level and aggressor.remaining > 0:
                passive = level[0]
                qty = min(aggressor.remaining, passive.remaining)
                aggressor.filled += qty
                passive.filled += qty

                trade = self._make_trade(aggressor, passive, exec_price, qty)
                trades.append(trade)

                if passive.is_done:
                    level.popleft()

            if not level:
                del opposite[best_key]

        return trades

    # ── Book manipulation ─────────────────────────────────────────────────────

    def _add_to_book(self, order: BookOrder) -> None:
        if order.side == "BUY":
            key = -order.price  # type: ignore[operator]
            book = self._bids
        else:
            key = order.price
            book = self._asks

        if key not in book:
            book[key] = deque()
        book[key].append(order)

    def _remove_from_book(self, order: BookOrder) -> None:
        if order.side == "BUY":
            key = -order.price  # type: ignore[operator]
            book = self._bids
        else:
            key = order.price
            book = self._asks

        if key in book:
            try:
                book[key].remove(order)
            except ValueError:
                pass
            if not book[key]:
                del book[key]

    def _make_trade(
        self,
        aggressor: BookOrder,
        passive: BookOrder,
        price: float,
        qty: int,
    ) -> TradeRecord:
        if aggressor.side == "BUY":
            buyer, seller = aggressor, passive
        else:
            buyer, seller = passive, aggressor

        return TradeRecord(
            ticker=self.ticker,
            price=round(price, 4),
            quantity=qty,
            buyer_order_id=buyer.order_id,
            seller_order_id=seller.order_id,
            aggressor_side=aggressor.side,
            buyer_user_id=buyer.user_id,
            seller_user_id=seller.user_id,
        )

    def clear(self) -> None:
        """Reset the book (called at Round end)."""
        self._bids.clear()
        self._asks.clear()
        self._orders.clear()
        self._last_trade_price = None
