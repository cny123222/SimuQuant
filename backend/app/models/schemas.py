from datetime import datetime
from typing import Any, Optional
from pydantic import BaseModel
from .db import OrderSide, OrderStatus, OrderType, RoundStatus, SessionStatus


# ── User ──────────────────────────────────────────────────────────────────────

class UserCreate(BaseModel):
    username: str

class UserOut(BaseModel):
    id: int
    username: str
    api_key: str
    is_admin: bool
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Ticker Config ─────────────────────────────────────────────────────────────

class TickerConfig(BaseModel):
    ticker: str
    initial_price: float = 100.0
    volatility: float = 0.02   # per tick σ
    drift: float = 0.0          # per tick μ
    jump_intensity: float = 0.01  # Poisson rate
    jump_size: float = 0.05       # relative jump magnitude
    settlement_price: Optional[float] = None  # fixed settlement price; None = use last trade price

    # per-ticker trading rules (override Round-level when set)
    allowed_order_types: list[str] = []   # e.g. ["IOC"], [] = use round default (all allowed)
    max_orders_per_second: Optional[int] = None  # None = use round-level value
    max_order_quantity: Optional[int] = None     # None = use round-level value

    # correlated price: fair value = price_multiplier × fair_value_of(price_ref_ticker) + residual GBM
    price_ref_ticker: Optional[str] = None   # e.g. "PRODB"  →  C anchors to B
    price_multiplier: float = 1.0            # e.g. 2.0  →  C_fv = 2 × B_fv
    residual_volatility: float = 0.005       # small independent noise for the correlated ticker

    # ETF creation / redemption
    # 10E ⟺ 2A + 3C + 4D  →  is_etf=True, etf_lot_size=10,
    #                          etf_basket=[{ticker:A,ratio:2},{ticker:C,ratio:3},{ticker:D,ratio:4}]
    is_etf: bool = False
    etf_lot_size: int = 10           # units of this ETF per lot
    etf_basket: list[dict] = []      # [{ticker: str, ratio: int}, ...]
    etf_fee: float = 0.0             # flat fee per create/redeem operation


# ── ETF operation ─────────────────────────────────────────────────────────────

class ETFOperateRequest(BaseModel):
    action: str   # "CREATE" | "REDEEM"
    lots: int     # number of lots (positive integer)

class ETFOperateResult(BaseModel):
    action: str
    lots: int
    etf_ticker: str
    etf_quantity_delta: int          # + for create, - for redeem
    basket_deltas: dict[str, int]    # ticker → quantity delta (negative for create)
    fee: float
    positions: list[dict]            # updated position snapshot


# ── Session ───────────────────────────────────────────────────────────────────

class SessionCreate(BaseModel):
    name: str

class SessionOut(BaseModel):
    id: int
    name: str
    status: SessionStatus
    created_at: datetime
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


# ── Round ─────────────────────────────────────────────────────────────────────

class RoundCreate(BaseModel):
    round_number: int
    name: Optional[str] = None
    duration_seconds: int = 180
    tickers_config: list[TickerConfig]
    mm_bot_count: int = 3
    noise_bot_count: int = 2
    mm_spread: float = 0.10
    mm_order_size: int = 10
    # trading rules
    order_fee: float = 0.0
    max_order_quantity: int = 0   # 0 = unlimited
    max_orders_per_second: int = 0  # 0 = unlimited

class RoundOut(BaseModel):
    id: int
    session_id: int
    round_number: int
    name: Optional[str] = None
    status: RoundStatus
    duration_seconds: int
    tickers_config: list[Any]
    mm_bot_count: int
    noise_bot_count: int
    mm_spread: float
    mm_order_size: int
    order_fee: float
    max_order_quantity: int
    max_orders_per_second: int
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


# ── Order ─────────────────────────────────────────────────────────────────────

class OrderCreate(BaseModel):
    ticker: str
    side: OrderSide
    order_type: OrderType
    price: Optional[float] = None
    quantity: int

class OrderOut(BaseModel):
    id: int
    round_id: int
    user_id: Optional[int] = None
    ticker: str
    side: OrderSide
    order_type: OrderType
    price: Optional[float] = None
    quantity: int
    filled_quantity: int
    status: OrderStatus
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Trade ─────────────────────────────────────────────────────────────────────

class TradeOut(BaseModel):
    id: int
    round_id: int
    ticker: str
    price: float
    quantity: int
    aggressor_side: OrderSide
    executed_at: datetime

    model_config = {"from_attributes": True}


# ── Position / PnL ────────────────────────────────────────────────────────────

class PositionOut(BaseModel):
    ticker: str
    quantity: int
    avg_cost: float
    realized_pnl: float
    unrealized_pnl: float
    total_pnl: float
    settlement_price: Optional[float] = None
    fees_paid: float = 0.0

    model_config = {"from_attributes": True}

class LeaderboardEntry(BaseModel):
    rank: int
    username: str
    total_pnl: float
    realized_pnl: float
    unrealized_pnl: float


# ── Market data ───────────────────────────────────────────────────────────────

class PriceLevel(BaseModel):
    price: float
    quantity: int

class OrderBookSnapshot(BaseModel):
    ticker: str
    bids: list[PriceLevel]  # best bid first
    asks: list[PriceLevel]  # best ask first
    timestamp: datetime

class PriceBar(BaseModel):
    timestamp: datetime
    open: float
    high: float
    low: float
    close: float
    volume: int


# ── WebSocket events ──────────────────────────────────────────────────────────

class WSEvent(BaseModel):
    type: str
    data: Any
