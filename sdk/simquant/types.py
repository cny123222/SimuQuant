"""
Shared data types for the SimuQuant Python SDK.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional


@dataclass
class PriceLevel:
    price: float
    quantity: int


@dataclass
class OrderBook:
    ticker: str
    bids: list[PriceLevel]   # best bid first
    asks: list[PriceLevel]   # best ask first
    last_price: Optional[float] = None
    fair_value: Optional[float] = None
    timestamp: Optional[datetime] = None

    @property
    def best_bid(self) -> Optional[float]:
        return self.bids[0].price if self.bids else None

    @property
    def best_ask(self) -> Optional[float]:
        return self.asks[0].price if self.asks else None

    @property
    def mid(self) -> Optional[float]:
        bb, ba = self.best_bid, self.best_ask
        if bb is not None and ba is not None:
            return (bb + ba) / 2
        return self.last_price

    @property
    def spread(self) -> Optional[float]:
        bb, ba = self.best_bid, self.best_ask
        if bb is not None and ba is not None:
            return ba - bb
        return None


@dataclass
class Order:
    id: int
    ticker: str
    side: str        # "BUY" | "SELL"
    order_type: str  # "LIMIT" | "MARKET"
    price: Optional[float]
    quantity: int
    filled_quantity: int
    status: str      # "OPEN" | "PARTIAL" | "FILLED" | "CANCELLED"
    created_at: datetime


@dataclass
class Trade:
    ticker: str
    price: float
    quantity: int
    aggressor_side: str
    executed_at: datetime


@dataclass
class Position:
    ticker: str
    quantity: int
    avg_cost: float
    realized_pnl: float
    unrealized_pnl: float
    total_pnl: float


@dataclass
class RoundState:
    round_id: int
    status: str  # "ACTIVE" | "FINISHED"
    duration_seconds: Optional[int] = None
    tickers: list[str] = field(default_factory=list)
