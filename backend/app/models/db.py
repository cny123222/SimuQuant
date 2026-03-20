from datetime import datetime
from enum import Enum as PyEnum

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Enum,
    JSON,
    Text,
)
from sqlalchemy.orm import DeclarativeBase, relationship


class Base(DeclarativeBase):
    pass


class SessionStatus(str, PyEnum):
    PENDING = "PENDING"
    ACTIVE = "ACTIVE"
    FINISHED = "FINISHED"


class RoundStatus(str, PyEnum):
    PENDING = "PENDING"
    ACTIVE = "ACTIVE"
    FINISHED = "FINISHED"


class OrderSide(str, PyEnum):
    BUY = "BUY"
    SELL = "SELL"


class OrderType(str, PyEnum):
    LIMIT = "LIMIT"
    MARKET = "MARKET"
    IOC = "IOC"


class OrderStatus(str, PyEnum):
    OPEN = "OPEN"
    PARTIAL = "PARTIAL"
    FILLED = "FILLED"
    CANCELLED = "CANCELLED"


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(64), unique=True, index=True, nullable=False)
    api_key = Column(String(64), unique=True, index=True, nullable=False)
    password_hash = Column(String(128), nullable=True)   # None = password not set yet
    is_admin = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    orders = relationship("Order", back_populates="user")
    positions = relationship("Position", back_populates="user")


class GameSession(Base):
    __tablename__ = "sessions"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(128), nullable=False)
    status = Column(Enum(SessionStatus), default=SessionStatus.PENDING)
    created_at = Column(DateTime, default=datetime.utcnow)
    started_at = Column(DateTime, nullable=True)
    finished_at = Column(DateTime, nullable=True)

    rounds = relationship("Round", back_populates="session", order_by="Round.round_number")


class Round(Base):
    __tablename__ = "rounds"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey("sessions.id"), nullable=False)
    round_number = Column(Integer, nullable=False)
    name = Column(String(128))
    status = Column(Enum(RoundStatus), default=RoundStatus.PENDING)
    duration_seconds = Column(Integer, default=180)

    # ticker config stored as JSON: [{"ticker": "AAPL", "initial_price": 100.0, "volatility": 0.02, "drift": 0.0}]
    tickers_config = Column(JSON, nullable=False, default=list)

    # bot config
    mm_bot_count = Column(Integer, default=3)
    noise_bot_count = Column(Integer, default=2)
    mm_spread = Column(Float, default=0.10)
    mm_order_size = Column(Integer, default=10)

    # trading rules
    order_fee = Column(Float, default=0.0)          # fee per submitted order (deducted from PnL)
    max_order_quantity = Column(Integer, default=0)  # 0 = unlimited
    max_orders_per_second = Column(Integer, default=0)  # 0 = unlimited
    max_position = Column(Integer, default=0)        # 0 = unlimited; e.g. 200 → ±200 per ticker

    started_at = Column(DateTime, nullable=True)
    finished_at = Column(DateTime, nullable=True)

    session = relationship("GameSession", back_populates="rounds")
    orders = relationship("Order", back_populates="round")
    trades = relationship("Trade", back_populates="round")
    positions = relationship("Position", back_populates="round")


class Order(Base):
    __tablename__ = "orders"

    id = Column(Integer, primary_key=True, index=True)
    round_id = Column(Integer, ForeignKey("rounds.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)  # NULL = bot
    bot_id = Column(String(64), nullable=True)

    ticker = Column(String(16), nullable=False)
    side = Column(Enum(OrderSide), nullable=False)
    order_type = Column(Enum(OrderType), nullable=False)
    price = Column(Float, nullable=True)  # NULL for market orders
    quantity = Column(Integer, nullable=False)
    filled_quantity = Column(Integer, default=0)
    status = Column(Enum(OrderStatus), default=OrderStatus.OPEN)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User", back_populates="orders")
    round = relationship("Round", back_populates="orders")


class Trade(Base):
    __tablename__ = "trades"

    id = Column(Integer, primary_key=True, index=True)
    round_id = Column(Integer, ForeignKey("rounds.id"), nullable=False)
    ticker = Column(String(16), nullable=False)
    price = Column(Float, nullable=False)
    quantity = Column(Integer, nullable=False)
    buyer_order_id = Column(Integer, ForeignKey("orders.id"), nullable=False)
    seller_order_id = Column(Integer, ForeignKey("orders.id"), nullable=False)
    aggressor_side = Column(Enum(OrderSide), nullable=False)
    executed_at = Column(DateTime, default=datetime.utcnow)

    round = relationship("Round", back_populates="trades")


class Position(Base):
    __tablename__ = "positions"

    id = Column(Integer, primary_key=True, index=True)
    round_id = Column(Integer, ForeignKey("rounds.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    ticker = Column(String(16), nullable=False)
    quantity = Column(Integer, default=0)
    realized_pnl = Column(Float, default=0.0)
    avg_cost = Column(Float, default=0.0)

    user = relationship("User", back_populates="positions")
    round = relationship("Round", back_populates="positions")
