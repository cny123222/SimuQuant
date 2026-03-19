"""
BaseStrategy – abstract base class for user trading strategies.

Users subclass this and override the async callbacks they care about.
The client property is injected by SimuQuantClient.run().
"""
from __future__ import annotations

from typing import TYPE_CHECKING, Optional

from .types import OrderBook, Position, RoundState, Trade

if TYPE_CHECKING:
    from .client import SimuQuantClient


class BaseStrategy:
    """
    Override any of the async methods below in your strategy.

    Example::

        class MyStrategy(BaseStrategy):
            async def on_orderbook(self, ticker: str, book: OrderBook):
                mid = book.mid
                if mid is None:
                    return
                await self.client.place_order(ticker, "BUY", "LIMIT", mid - 0.05, 10)
                await self.client.place_order(ticker, "SELL", "LIMIT", mid + 0.05, 10)
    """

    client: "SimuQuantClient"  # injected by SimuQuantClient.run()

    # ── Lifecycle ─────────────────────────────────────────────────────────────

    async def on_start(self) -> None:
        """Called once when the round connection is established."""

    async def on_stop(self) -> None:
        """Called once when the round ends or client disconnects."""

    # ── Market events ─────────────────────────────────────────────────────────

    async def on_orderbook(self, ticker: str, book: OrderBook) -> None:
        """Called on every order book update tick (≈ every 0.5s per ticker)."""

    async def on_trade(self, trade: Trade) -> None:
        """Called whenever a trade executes in the market."""

    async def on_position_update(self, positions: list[Position]) -> None:
        """Called after any fill that affects your positions."""

    async def on_round_state(self, state: RoundState) -> None:
        """Called when the round starts or finishes."""

    # ── Convenience helpers ───────────────────────────────────────────────────

    async def buy_limit(self, ticker: str, price: float, quantity: int):
        return await self.client.place_order(ticker, "BUY", "LIMIT", price=price, quantity=quantity)

    async def sell_limit(self, ticker: str, price: float, quantity: int):
        return await self.client.place_order(ticker, "SELL", "LIMIT", price=price, quantity=quantity)

    async def buy_market(self, ticker: str, quantity: int):
        return await self.client.place_order(ticker, "BUY", "MARKET", quantity=quantity)

    async def sell_market(self, ticker: str, quantity: int):
        return await self.client.place_order(ticker, "SELL", "MARKET", quantity=quantity)

    def get_position(self, ticker: str) -> Optional[Position]:
        for p in self.client.positions:
            if p.ticker == ticker:
                return p
        return None

    def total_pnl(self) -> float:
        return sum(p.total_pnl for p in self.client.positions)
