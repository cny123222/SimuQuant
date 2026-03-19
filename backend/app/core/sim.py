"""
Price simulator using Geometric Brownian Motion (GBM) with optional
Poisson jump-diffusion and correlated price anchoring.

Correlated ticker:
  C_fair_value = price_multiplier × B_fair_value × exp(residual_noise)

The simulator drives "fair value" used by bots.  Market prices emerge from
actual order matching and may diverge from fair value (creating arb opportunities).
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
    volatility: float      # σ per tick (primary GBM)
    drift: float           # μ per tick
    jump_intensity: float
    jump_size: float

    # Correlated anchor
    price_ref_ticker: Optional[str] = None  # anchor to this ticker's fair value
    price_multiplier: float = 1.0           # fair_value = multiplier × ref_fv
    residual_volatility: float = 0.005      # small residual noise

    price_history: list[float] = field(default_factory=list)

    def tick_independent(self, dt: float = 1.0) -> float:
        """Advance as a fully independent GBM + jumps."""
        z = random.gauss(0, 1)
        gbm = (self.drift - 0.5 * self.volatility ** 2) * dt + self.volatility * math.sqrt(dt) * z
        jump = 0.0
        if random.random() < self.jump_intensity * dt:
            jump = random.uniform(-self.jump_size, self.jump_size)
        self.fair_value *= math.exp(gbm + jump)
        self.fair_value = max(self.fair_value, 0.01)
        self._record()
        return self.fair_value

    def tick_correlated(self, ref_fv: float, dt: float = 1.0) -> float:
        """Advance anchored to ref_fv × price_multiplier, with residual noise."""
        target = ref_fv * self.price_multiplier
        # Residual: small GBM around the anchor
        z = random.gauss(0, 1)
        residual = self.residual_volatility * math.sqrt(dt) * z
        # Mean-revert toward target with strength 0.3 per tick to avoid drift
        reversion = 0.3 * math.log(target / self.fair_value) if self.fair_value > 0 else 0.0
        self.fair_value *= math.exp(reversion + residual)
        self.fair_value = max(self.fair_value, 0.01)
        self._record()
        return self.fair_value

    def _record(self) -> None:
        self.price_history.append(round(self.fair_value, 4))
        if len(self.price_history) > 1000:
            self.price_history = self.price_history[-1000:]


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
                price_ref_ticker=cfg.get("price_ref_ticker"),
                price_multiplier=cfg.get("price_multiplier", 1.0),
                residual_volatility=cfg.get("residual_volatility", 0.005),
            )

    def get_fair_value(self, ticker: str) -> Optional[float]:
        state = self._states.get(ticker)
        return state.fair_value if state else None

    def tick_all(self, dt: float = 1.0) -> dict[str, float]:
        results: dict[str, float] = {}

        # First pass: tick all independent tickers
        for ticker, state in self._states.items():
            if state.price_ref_ticker is None:
                results[ticker] = state.tick_independent(dt)

        # Second pass: tick correlated tickers (after their reference is updated)
        for ticker, state in self._states.items():
            if state.price_ref_ticker is not None:
                ref_fv = results.get(state.price_ref_ticker)
                if ref_fv is None:
                    # ref ticker not processed yet (shouldn't happen for independent refs)
                    ref_fv = self.get_fair_value(state.price_ref_ticker) or state.fair_value
                results[ticker] = state.tick_correlated(ref_fv, dt)

        return results

    def tick_ticker(self, ticker: str, dt: float = 1.0) -> Optional[float]:
        state = self._states.get(ticker)
        if not state:
            return None
        if state.price_ref_ticker:
            ref_fv = self.get_fair_value(state.price_ref_ticker) or state.fair_value
            return state.tick_correlated(ref_fv, dt)
        return state.tick_independent(dt)

    @property
    def tickers(self) -> list[str]:
        return list(self._states.keys())
