from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import get_current_user
from ..core.session import session_manager
from ..db import get_db
from ..models.db import Round, RoundStatus, Trade, User
from ..models.schemas import LeaderboardEntry, OrderBookSnapshot, PositionOut, PriceLevel

router = APIRouter(prefix="/rounds", tags=["market"])


@router.get("/{round_id}/orderbook/{ticker}", response_model=OrderBookSnapshot)
async def get_orderbook(
    round_id: int,
    ticker: str,
    depth: int = 5,
    _user: User = Depends(get_current_user),
):
    rt = session_manager.get_round_runtime(round_id)
    if not rt:
        raise HTTPException(503, "Round not active")
    book = rt.books.get(ticker)
    if not book:
        raise HTTPException(404, f"Ticker {ticker} not found")

    snap = book.snapshot(depth=depth)
    return OrderBookSnapshot(
        ticker=snap["ticker"],
        bids=[PriceLevel(**b) for b in snap["bids"]],
        asks=[PriceLevel(**a) for a in snap["asks"]],
        timestamp=datetime.utcnow(),
    )


@router.get("/{round_id}/positions", response_model=list[PositionOut])
async def get_positions(
    round_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    rt = session_manager.get_round_runtime(round_id)
    if not rt:
        # Round finished – return empty list (could later query DB snapshot)
        return []
    return rt.get_position_snapshot(user.id)


@router.get("/{round_id}/price-history/{ticker}")
async def get_price_history(
    round_id: int,
    ticker: str,
    _user: User = Depends(get_current_user),
):
    rt = session_manager.get_round_runtime(round_id)
    if not rt:
        raise HTTPException(503, "Round not active")
    history = rt.price_history.get(ticker, [])
    return [
        {"timestamp": ts.isoformat(), "price": price}
        for ts, price in history
    ]


@router.get("/{round_id}/leaderboard", response_model=list[LeaderboardEntry])
async def get_leaderboard(
    round_id: int,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    rt = session_manager.get_round_runtime(round_id)
    if not rt:
        raise HTTPException(503, "Round not active")

    entries: list[LeaderboardEntry] = []
    from ..models.db import User as UserModel
    result = await db.execute(select(UserModel))
    users = result.scalars().all()

    for user in users:
        positions = rt.get_position_snapshot(user.id)
        if not positions:
            continue
        realized = sum(p["realized_pnl"] for p in positions)
        unrealized = sum(p["unrealized_pnl"] for p in positions)
        entries.append(LeaderboardEntry(
            rank=0,
            username=user.username,
            total_pnl=round(realized + unrealized, 4),
            realized_pnl=round(realized, 4),
            unrealized_pnl=round(unrealized, 4),
        ))

    entries.sort(key=lambda e: e.total_pnl, reverse=True)
    for i, e in enumerate(entries):
        e.rank = i + 1

    return entries
