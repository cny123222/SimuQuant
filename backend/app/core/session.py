"""
In-memory Session/Round state machine.

Persisted state lives in the DB; this module maintains the runtime state
(order books, active tasks, position cache) that doesn't need to survive
restarts of the process.
"""
from __future__ import annotations

import asyncio
import time
from datetime import datetime
from typing import Optional

from .engine import LimitOrderBook


class RoundRuntime:
    """Runtime state for an active Round."""

    def __init__(
        self,
        round_id: int,
        tickers: list[str],
        settlement_prices: Optional[dict[str, float]] = None,
        order_fee: float = 0.0,
        max_order_quantity: int = 0,
        max_orders_per_second: int = 0,
        ticker_rules: Optional[dict[str, dict]] = None,
    ):
        self.round_id = round_id
        self.books: dict[str, LimitOrderBook] = {
            ticker: LimitOrderBook(ticker) for ticker in tickers
        }
        # in-memory position state: {user_id: {ticker: {"qty": int, "avg_cost": float, "realized": float}}}
        self.positions: dict[int, dict[str, dict]] = {}
        # price history for chart: {ticker: [(ts, price), ...]}
        self.price_history: dict[str, list[tuple[datetime, float]]] = {t: [] for t in tickers}
        # background task handles
        self._tasks: list[asyncio.Task] = []

        # trading rules (round-level)
        self.settlement_prices: dict[str, float] = settlement_prices or {}
        self.order_fee: float = order_fee
        self.max_order_quantity: int = max_order_quantity
        self.max_orders_per_second: int = max_orders_per_second

        # per-ticker overrides: {ticker: {allowed_order_types, max_orders_per_second, max_order_quantity}}
        self.ticker_rules: dict[str, dict] = ticker_rules or {}

        # rate limiting: {(user_id, ticker): [timestamp, ...]} – sliding window per user per ticker
        self._order_timestamps: dict[tuple, list[float]] = {}

    def register_position(self, user_id: int, ticker: str) -> None:
        if user_id not in self.positions:
            self.positions[user_id] = {}
        if ticker not in self.positions[user_id]:
            self.positions[user_id][ticker] = {
                "qty": 0, "avg_cost": 0.0, "realized": 0.0, "fees_paid": 0.0
            }

    def apply_order_fee(self, user_id: int, ticker: str, fee: float) -> None:
        """Deduct order fee from realized PnL (applies at order submission time)."""
        if fee <= 0:
            return
        self.register_position(user_id, ticker)
        pos = self.positions[user_id][ticker]
        pos["realized"] -= fee
        pos["fees_paid"] = pos.get("fees_paid", 0.0) + fee

    def apply_trade_to_position(
        self,
        user_id: int,
        ticker: str,
        side: str,
        price: float,
        qty: int,
    ) -> None:
        self.register_position(user_id, ticker)
        pos = self.positions[user_id][ticker]

        if side == "BUY":
            total_cost = pos["avg_cost"] * pos["qty"] + price * qty
            pos["qty"] += qty
            pos["avg_cost"] = total_cost / pos["qty"] if pos["qty"] else 0.0
        else:
            if pos["qty"] >= qty:
                realized = (price - pos["avg_cost"]) * qty
                pos["realized"] += realized
                pos["qty"] -= qty
                if pos["qty"] == 0:
                    pos["avg_cost"] = 0.0
            else:
                # short selling: track negative qty
                total_cost = pos["avg_cost"] * pos["qty"] - price * (qty - pos["qty"])
                realized = (price - pos["avg_cost"]) * pos["qty"]
                pos["realized"] += realized
                pos["qty"] -= qty
                pos["avg_cost"] = price if pos["qty"] != 0 else 0.0

    def get_unrealized_pnl(self, user_id: int, ticker: str, last_price: Optional[float]) -> float:
        if user_id not in self.positions or ticker not in self.positions[user_id]:
            return 0.0
        pos = self.positions[user_id][ticker]
        if pos["qty"] == 0:
            return 0.0
        # Use settlement_price if configured, otherwise fall back to last trade price
        mark_price = self.settlement_prices.get(ticker, last_price)
        if mark_price is None:
            return 0.0
        return (mark_price - pos["avg_cost"]) * pos["qty"]

    def check_rate_limit(self, user_id: int, ticker: str) -> bool:
        """Return True if the user is within the rate limit for that ticker, False if exceeded."""
        # Per-ticker limit overrides round-level limit
        trules = self.ticker_rules.get(ticker, {})
        limit = trules.get("max_orders_per_second") if trules.get("max_orders_per_second") is not None else self.max_orders_per_second
        if not limit or limit <= 0:
            return True
        now = time.monotonic()
        key = (user_id, ticker)
        window = self._order_timestamps.setdefault(key, [])
        cutoff = now - 1.0
        self._order_timestamps[key] = [t for t in window if t > cutoff]
        if len(self._order_timestamps[key]) >= limit:
            return False
        self._order_timestamps[key].append(now)
        return True

    def check_order_type_allowed(self, ticker: str, order_type: str) -> bool:
        """Return True if the order type is allowed for this ticker."""
        trules = self.ticker_rules.get(ticker, {})
        allowed = trules.get("allowed_order_types", [])
        if not allowed:
            return True  # no restriction
        return order_type in allowed

    def get_max_order_quantity(self, ticker: str) -> int:
        """Return per-ticker max order quantity, falling back to round-level."""
        trules = self.ticker_rules.get(ticker, {})
        v = trules.get("max_order_quantity")
        if v is not None:
            return v
        return self.max_order_quantity

    def get_rate_limit(self, ticker: str) -> int:
        """Return per-ticker rate limit, falling back to round-level."""
        trules = self.ticker_rules.get(ticker, {})
        v = trules.get("max_orders_per_second")
        if v is not None:
            return v
        return self.max_orders_per_second

    def get_position_snapshot(self, user_id: int) -> list[dict]:
        result = []
        for ticker, pos in self.positions.get(user_id, {}).items():
            last_price = self.books[ticker].last_price if ticker in self.books else None
            unrealized = self.get_unrealized_pnl(user_id, ticker, last_price)
            # settlement_price shown if configured
            sp = self.settlement_prices.get(ticker)
            result.append({
                "ticker": ticker,
                "quantity": pos["qty"],
                "avg_cost": round(pos["avg_cost"], 4),
                "realized_pnl": round(pos["realized"], 4),
                "unrealized_pnl": round(unrealized, 4),
                "total_pnl": round(pos["realized"] + unrealized, 4),
                "settlement_price": sp,
                "fees_paid": round(pos.get("fees_paid", 0.0), 4),
            })
        return result

    def add_price_point(self, ticker: str, price: float) -> None:
        if ticker in self.price_history:
            self.price_history[ticker].append((datetime.utcnow(), price))
            # keep last 500 ticks
            if len(self.price_history[ticker]) > 500:
                self.price_history[ticker] = self.price_history[ticker][-500:]

    def add_task(self, task: asyncio.Task) -> None:
        self._tasks.append(task)

    def cancel_tasks(self) -> None:
        for t in self._tasks:
            if not t.done():
                t.cancel()
        self._tasks.clear()


class SessionManager:
    """Global registry of active round runtimes."""

    def __init__(self) -> None:
        self._rounds: dict[int, RoundRuntime] = {}

    def create_round_runtime(
        self,
        round_id: int,
        tickers: list[str],
        settlement_prices: Optional[dict[str, float]] = None,
        order_fee: float = 0.0,
        max_order_quantity: int = 0,
        max_orders_per_second: int = 0,
        ticker_rules: Optional[dict[str, dict]] = None,
    ) -> RoundRuntime:
        rt = RoundRuntime(
            round_id=round_id,
            tickers=tickers,
            settlement_prices=settlement_prices,
            order_fee=order_fee,
            max_order_quantity=max_order_quantity,
            max_orders_per_second=max_orders_per_second,
            ticker_rules=ticker_rules,
        )
        self._rounds[round_id] = rt
        return rt

    def get_round_runtime(self, round_id: int) -> Optional[RoundRuntime]:
        return self._rounds.get(round_id)

    def remove_round_runtime(self, round_id: int) -> None:
        rt = self._rounds.pop(round_id, None)
        if rt:
            rt.cancel_tasks()

    def active_round_ids(self) -> list[int]:
        return list(self._rounds.keys())


# Singleton
session_manager = SessionManager()
