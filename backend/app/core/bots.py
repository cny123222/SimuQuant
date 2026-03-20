"""
Market simulation bots.

MarketMakerBot – posts two-sided quotes around fair value.
NoiseTraderBot  – fires random market orders to consume liquidity.

BotManager creates and supervises bot coroutines for a given Round.
"""
from __future__ import annotations

import asyncio
import random
import uuid
from typing import Optional

from .engine import BookOrder, LimitOrderBook
from .session import RoundRuntime
from .sim import MarketSimulator


_ORDER_ID_COUNTER: int = 10_000_000  # bots use IDs above this range


def _next_bot_order_id() -> int:
    global _ORDER_ID_COUNTER
    _ORDER_ID_COUNTER += 1
    return _ORDER_ID_COUNTER


class MarketMakerBot:
    """
    Posts multi-level two-sided quotes around fair value.
    Each bot places `num_levels` bid/ask pairs at increasing distances,
    producing a realistic deep order book.
    """

    def __init__(
        self,
        bot_id: str,
        ticker: str,
        book: LimitOrderBook,
        sim: MarketSimulator,
        spread: float = 0.10,
        order_size: int = 10,
        tick_interval: float = 0.5,
        num_levels: int = 5,
        level_step: float = 0.03,
    ):
        self.bot_id = bot_id
        self.ticker = ticker
        self.book = book
        self.sim = sim
        self.spread = spread
        self.order_size = order_size
        self.tick_interval = tick_interval
        self.num_levels = num_levels
        self.level_step = level_step

        self._order_ids: list[int] = []

    async def run(self, stop_event: asyncio.Event) -> None:
        while not stop_event.is_set():
            try:
                await self._refresh_quotes()
            except Exception:
                pass
            await asyncio.sleep(self.tick_interval + random.uniform(-0.1, 0.1))

    async def _refresh_quotes(self) -> None:
        fv = self.sim.get_fair_value(self.ticker)
        if fv is None:
            return

        for oid in self._order_ids:
            await self.book.cancel_order(oid)
        self._order_ids.clear()

        half = self.spread / 2
        bot_noise = random.uniform(-0.01, 0.01)

        for lvl in range(self.num_levels):
            offset = half + lvl * self.level_step
            noise = bot_noise + random.uniform(-0.005, 0.005)
            bid_price = round(fv - offset + noise, 2)
            ask_price = round(fv + offset - noise, 2)

            if bid_price <= 0 or ask_price <= bid_price:
                continue

            size = max(1, self.order_size - lvl)

            bid_id = _next_bot_order_id()
            ask_id = _next_bot_order_id()

            bid = BookOrder(
                order_id=bid_id, user_id=None, bot_id=self.bot_id,
                side="BUY", order_type="LIMIT", price=bid_price, quantity=size,
            )
            ask = BookOrder(
                order_id=ask_id, user_id=None, bot_id=self.bot_id,
                side="SELL", order_type="LIMIT", price=ask_price, quantity=size,
            )

            await self.book.process_order(bid)
            await self.book.process_order(ask)
            self._order_ids.extend([bid_id, ask_id])


class NoiseTraderBot:
    """Fires small random market orders to consume liquidity."""

    def __init__(
        self,
        bot_id: str,
        ticker: str,
        book: LimitOrderBook,
        tick_interval: float = 1.5,
        max_quantity: int = 5,
    ):
        self.bot_id = bot_id
        self.ticker = ticker
        self.book = book
        self.tick_interval = tick_interval
        self.max_quantity = max_quantity

    async def run(self, stop_event: asyncio.Event) -> None:
        while not stop_event.is_set():
            await asyncio.sleep(self.tick_interval + random.uniform(-0.5, 0.5))
            try:
                await self._fire_random_order()
            except Exception:
                pass

    async def _fire_random_order(self) -> None:
        side = random.choice(["BUY", "SELL"])
        qty = random.randint(1, self.max_quantity)
        order = BookOrder(
            order_id=_next_bot_order_id(),
            user_id=None,
            bot_id=self.bot_id,
            side=side,
            order_type="MARKET",
            price=None,
            quantity=qty,
        )
        await self.book.process_order(order)


class BotManager:
    """
    Spawns and supervises all bots for a single Round.
    Also drives the price simulator and pushes orderbook_update events.
    """

    def __init__(
        self,
        round_runtime: RoundRuntime,
        sim: MarketSimulator,
        mm_bot_count: int = 3,
        noise_bot_count: int = 2,
        mm_spread: float = 0.10,
        mm_order_size: int = 10,
        tick_interval: float = 0.5,
    ):
        self.rt = round_runtime
        self.sim = sim
        self.mm_bot_count = mm_bot_count
        self.noise_bot_count = noise_bot_count
        self.mm_spread = mm_spread
        self.mm_order_size = mm_order_size
        self.tick_interval = tick_interval

        self._stop_event = asyncio.Event()

    def start(self, broadcast_fn) -> None:
        """
        Launch all bot coroutines and the price-tick loop.
        broadcast_fn(ticker, snapshot) is called after each sim tick.
        """
        for ticker in self.sim.tickers:
            book = self.rt.books[ticker]

            for i in range(self.mm_bot_count):
                bot_id = f"mm_{ticker}_{i}_{uuid.uuid4().hex[:6]}"
                bot = MarketMakerBot(
                    bot_id=bot_id,
                    ticker=ticker,
                    book=book,
                    sim=self.sim,
                    spread=self.mm_spread,
                    order_size=self.mm_order_size,
                    tick_interval=self.tick_interval,
                )
                task = asyncio.create_task(bot.run(self._stop_event))
                self.rt.add_task(task)

            for i in range(self.noise_bot_count):
                bot_id = f"noise_{ticker}_{i}_{uuid.uuid4().hex[:6]}"
                bot = NoiseTraderBot(
                    bot_id=bot_id,
                    ticker=ticker,
                    book=book,
                    tick_interval=self.tick_interval * 3,
                )
                task = asyncio.create_task(bot.run(self._stop_event))
                self.rt.add_task(task)

        # price tick loop
        task = asyncio.create_task(self._price_tick_loop(broadcast_fn))
        self.rt.add_task(task)

    async def _price_tick_loop(self, broadcast_fn) -> None:
        while not self._stop_event.is_set():
            await asyncio.sleep(self.tick_interval)
            try:
                new_prices = self.sim.tick_all(dt=1.0)
                for ticker, price in new_prices.items():
                    self.rt.add_price_point(ticker, price)
                    snapshot = self.rt.books[ticker].snapshot()
                    snapshot["fair_value"] = round(price, 4)
                    await broadcast_fn(ticker, snapshot)
            except Exception:
                pass

    def stop(self) -> None:
        self._stop_event.set()
