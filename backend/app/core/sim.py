"""
Price simulator using Geometric Brownian Motion (GBM) with optional
Poisson jump-diffusion.

The simulator drives the "fair value" that bots use as their pricing anchor.
It does NOT directly set market prices — prices emerge from bot/user trading.
"""
from __future__ import annotations

import math
import random
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class TickerSimState:
    ticker: str
    fair_value: float
    volatility: float    # σ per tick
    drift: float         # μ per tick (annualized / 252 / ticks_per_day)
    jump_intensity: float  # Poisson rate per tick
    jump_size: float       # |relative jump| ~ Uniform(-size, +size)
    price_history: list[float] = field(default_factory=list)

    def tick(self, dt: float = 1.0) -> float:
        """Advance fair value by one simulation step and return new value."""
        z = random.gauss(0, 1)
        gbm_return = (self.drift - 0.5 * self.volatility ** 2) * dt + self.volatility * math.sqrt(dt) * z

        jump = 0.0
        if random.random() < self.jump_intensity * dt:
            jump = random.uniform(-self.jump_size, self.jump_size)

        self.fair_value *= math.exp(gbm_return + jump)
        self.fair_value = max(self.fair_value, 0.01)  # floor at 1 cent
        self.price_history.append(round(self.fair_value, 4))
        if len(self.price_history) > 1000:
            self.price_history = self.price_history[-1000:]
        return self.fair_value


class MarketSimulator:
    """Manages simulation state for all tickers in a Round."""

    def __init__(self, tickers_config: list[dict]):
        self._states: dict[str, TickerSimState] = {}
        for cfg in tickers_config:
            self._states[cfg["ticker"]] = TickerSimState(
                ticker=cfg["ticker"],
                fair_value=cfg.get("initial_price", 100.0),
                volatility=cfg.get("volatility", 0.02),
                drift=cfg.get("drift", 0.0),
                jump_intensity=cfg.get("jump_intensity", 0.01),
                jump_size=cfg.get("jump_size", 0.05),
            )

    def get_fair_value(self, ticker: str) -> Optional[float]:
        state = self._states.get(ticker)
        return state.fair_value if state else None

    def tick_all(self, dt: float = 1.0) -> dict[str, float]:
        return {ticker: state.tick(dt) for ticker, state in self._states.items()}

    def tick_ticker(self, ticker: str, dt: float = 1.0) -> Optional[float]:
        state = self._states.get(ticker)
        return state.tick(dt) if state else None

    @property
    def tickers(self) -> list[str]:
        return list(self._states.keys())
