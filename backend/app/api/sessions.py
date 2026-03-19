import asyncio
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import get_admin_user, get_current_user
from ..core.bots import BotManager
from ..core.session import session_manager
from ..core.sim import MarketSimulator
from ..core.trade_handler import TradeHandler
from ..core.ws_manager import ws_manager
from ..db import AsyncSessionLocal, get_db
from ..models.db import GameSession, Round, RoundStatus, SessionStatus, User
from ..models.schemas import RoundCreate, RoundOut, SessionCreate, SessionOut

router = APIRouter(prefix="/sessions", tags=["sessions"])


# ── Sessions ──────────────────────────────────────────────────────────────────

@router.post("", response_model=SessionOut)
async def create_session(
    payload: SessionCreate,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(get_admin_user),
):
    session = GameSession(name=payload.name)
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return session


@router.get("", response_model=list[SessionOut])
async def list_sessions(
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    result = await db.execute(select(GameSession).order_by(GameSession.id.desc()))
    return result.scalars().all()


@router.get("/{session_id}", response_model=SessionOut)
async def get_session(
    session_id: int,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    session = await db.get(GameSession, session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    return session


# ── Rounds ────────────────────────────────────────────────────────────────────

@router.post("/{session_id}/rounds", response_model=RoundOut)
async def create_round(
    session_id: int,
    payload: RoundCreate,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(get_admin_user),
):
    session = await db.get(GameSession, session_id)
    if not session:
        raise HTTPException(404, "Session not found")

    round_ = Round(
        session_id=session_id,
        round_number=payload.round_number,
        name=payload.name,
        duration_seconds=payload.duration_seconds,
        tickers_config=[tc.model_dump() for tc in payload.tickers_config],
        mm_bot_count=payload.mm_bot_count,
        noise_bot_count=payload.noise_bot_count,
        mm_spread=payload.mm_spread,
        mm_order_size=payload.mm_order_size,
    )
    db.add(round_)
    await db.commit()
    await db.refresh(round_)
    return round_


@router.get("/{session_id}/rounds", response_model=list[RoundOut])
async def list_rounds(
    session_id: int,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Round).where(Round.session_id == session_id).order_by(Round.round_number)
    )
    return result.scalars().all()


@router.get("/{session_id}/rounds/{round_id}", response_model=RoundOut)
async def get_round(
    session_id: int,
    round_id: int,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    round_ = await db.get(Round, round_id)
    if not round_ or round_.session_id != session_id:
        raise HTTPException(404, "Round not found")
    return round_


@router.post("/{session_id}/rounds/{round_id}/start", response_model=RoundOut)
async def start_round(
    session_id: int,
    round_id: int,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(get_admin_user),
):
    round_ = await db.get(Round, round_id)
    if not round_ or round_.session_id != session_id:
        raise HTTPException(404, "Round not found")
    if round_.status != RoundStatus.PENDING:
        raise HTTPException(400, f"Round is already {round_.status}")

    session = await db.get(GameSession, session_id)
    if session.status == SessionStatus.PENDING:
        session.status = SessionStatus.ACTIVE
        session.started_at = datetime.utcnow()

    round_.status = RoundStatus.ACTIVE
    round_.started_at = datetime.utcnow()
    await db.commit()
    await db.refresh(round_)

    tickers = [tc["ticker"] for tc in round_.tickers_config]
    rt = session_manager.create_round_runtime(round_id, tickers)

    # Wire trade handler (one callback per book)
    handler = TradeHandler(round_id, rt)
    handler.attach_to_books()

    sim = MarketSimulator(round_.tickers_config)

    async def broadcast_book(ticker: str, snapshot: dict) -> None:
        await ws_manager.broadcast(round_id, "orderbook_update", snapshot)

    bot_mgr = BotManager(
        round_runtime=rt,
        sim=sim,
        mm_bot_count=round_.mm_bot_count,
        noise_bot_count=round_.noise_bot_count,
        mm_spread=round_.mm_spread,
        mm_order_size=round_.mm_order_size,
    )
    bot_mgr.start(broadcast_book)

    # Schedule auto-finish in a background task
    duration = round_.duration_seconds

    async def auto_finish() -> None:
        await asyncio.sleep(duration)
        async with AsyncSessionLocal() as finish_db:
            r = await finish_db.get(Round, round_id)
            if r and r.status == RoundStatus.ACTIVE:
                r.status = RoundStatus.FINISHED
                r.finished_at = datetime.utcnow()
                await finish_db.commit()
        bot_mgr.stop()
        session_manager.remove_round_runtime(round_id)
        await ws_manager.broadcast(round_id, "round_state", {
            "round_id": round_id,
            "status": "FINISHED",
        })

    task = asyncio.create_task(auto_finish())
    rt.add_task(task)

    await ws_manager.broadcast(round_id, "round_state", {
        "round_id": round_id,
        "status": "ACTIVE",
        "duration_seconds": duration,
        "tickers": tickers,
    })

    return round_


@router.post("/{session_id}/rounds/{round_id}/finish", response_model=RoundOut)
async def finish_round(
    session_id: int,
    round_id: int,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(get_admin_user),
):
    round_ = await db.get(Round, round_id)
    if not round_ or round_.session_id != session_id:
        raise HTTPException(404, "Round not found")
    if round_.status == RoundStatus.FINISHED:
        return round_

    round_.status = RoundStatus.FINISHED
    round_.finished_at = datetime.utcnow()
    await db.commit()
    await db.refresh(round_)

    session_manager.remove_round_runtime(round_id)
    await ws_manager.broadcast(round_id, "round_state", {
        "round_id": round_id,
        "status": "FINISHED",
    })
    return round_
