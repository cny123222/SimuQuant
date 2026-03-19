from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import get_current_user
from ..core.engine import BookOrder
from ..core.session import session_manager
from ..db import get_db
from ..models.db import Order, OrderStatus, Round, RoundStatus, Trade, User
from ..models.schemas import OrderCreate, OrderOut, TradeOut

router = APIRouter(prefix="/rounds", tags=["orders"])


@router.post("/{round_id}/orders", response_model=OrderOut)
async def place_order(
    round_id: int,
    payload: OrderCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    round_ = await db.get(Round, round_id)
    if not round_:
        raise HTTPException(404, "Round not found")
    if round_.status != RoundStatus.ACTIVE:
        raise HTTPException(400, "Round is not active")

    tickers = [tc["ticker"] for tc in round_.tickers_config]
    if payload.ticker not in tickers:
        raise HTTPException(400, f"Ticker {payload.ticker} not in this round")

    if payload.order_type == "LIMIT" and payload.price is None:
        raise HTTPException(400, "LIMIT orders require a price")
    if payload.order_type == "IOC" and payload.price is None:
        raise HTTPException(400, "IOC orders require a price")
    if payload.quantity <= 0:
        raise HTTPException(400, "Quantity must be positive")

    rt = session_manager.get_round_runtime(round_id)
    if not rt:
        raise HTTPException(503, "Round runtime not available")

    # ── Trading rule checks ──────────────────────────────────────────────────

    # 1. Max order quantity
    if rt.max_order_quantity > 0 and payload.quantity > rt.max_order_quantity:
        raise HTTPException(
            400,
            f"Order quantity {payload.quantity} exceeds max allowed {rt.max_order_quantity}"
        )

    # 2. Rate limiting (per-user sliding window)
    if not rt.check_rate_limit(user.id):
        raise HTTPException(
            429,
            f"Rate limit exceeded: max {rt.max_orders_per_second} orders/second"
        )

    # Ensure position slots exist for all tickers
    for tc in round_.tickers_config:
        rt.register_position(user.id, tc["ticker"])

    # 3. Deduct order fee immediately (before matching)
    if rt.order_fee > 0:
        rt.apply_order_fee(user.id, payload.ticker, rt.order_fee)

    # Persist order first to obtain a stable DB id
    order_db = Order(
        round_id=round_id,
        user_id=user.id,
        ticker=payload.ticker,
        side=payload.side,
        order_type=payload.order_type,
        price=payload.price,
        quantity=payload.quantity,
        filled_quantity=0,
        status=OrderStatus.OPEN,
    )
    db.add(order_db)
    await db.commit()
    await db.refresh(order_db)

    book = rt.books[payload.ticker]

    book_order = BookOrder(
        order_id=order_db.id,
        user_id=user.id,
        bot_id=None,
        side=payload.side.value,
        order_type=payload.order_type.value,
        price=payload.price,
        quantity=payload.quantity,
    )

    result = await book.process_order(book_order)

    # Sync DB order status back
    order_db.filled_quantity = book_order.filled
    order_db.status = result.order_status
    await db.commit()
    await db.refresh(order_db)

    # Push position update after fee deduction
    positions = rt.get_position_snapshot(user.id)
    from ..core.ws_manager import ws_manager
    await ws_manager.send_to_user(round_id, user.id, "position_update", positions)

    return order_db


@router.delete("/{round_id}/orders/{order_id}", response_model=OrderOut)
async def cancel_order(
    round_id: int,
    order_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    order_db = await db.get(Order, order_id)
    if not order_db or order_db.round_id != round_id:
        raise HTTPException(404, "Order not found")
    if order_db.user_id != user.id:
        raise HTTPException(403, "Not your order")
    if order_db.status in (OrderStatus.FILLED, OrderStatus.CANCELLED):
        raise HTTPException(400, f"Order already {order_db.status}")

    rt = session_manager.get_round_runtime(round_id)
    if rt:
        book = rt.books.get(order_db.ticker)
        if book:
            await book.cancel_order(order_id)

    order_db.status = OrderStatus.CANCELLED
    await db.commit()
    await db.refresh(order_db)
    return order_db


@router.get("/{round_id}/orders", response_model=list[OrderOut])
async def get_my_orders(
    round_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Order)
        .where(Order.round_id == round_id, Order.user_id == user.id)
        .order_by(Order.created_at.desc())
    )
    return result.scalars().all()


@router.get("/{round_id}/trades", response_model=list[TradeOut])
async def get_trades(
    round_id: int,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Trade)
        .where(Trade.round_id == round_id)
        .order_by(Trade.executed_at.desc())
        .limit(200)
    )
    return result.scalars().all()
