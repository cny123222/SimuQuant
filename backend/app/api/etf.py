"""
ETF creation / redemption endpoint.

POST /rounds/{round_id}/etf/{ticker}/operate
Body: {"action": "CREATE"|"REDEEM", "lots": N}

CREATE: deliver basket components → receive ETF units
REDEEM: deliver ETF units → receive basket components
Fee is deducted from realized PnL at operation time.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import get_current_user
from ..core.session import session_manager
from ..core.ws_manager import ws_manager
from ..db import get_db
from ..models.db import Round, RoundStatus, User
from ..models.schemas import ETFOperateRequest, ETFOperateResult

router = APIRouter(prefix="/rounds", tags=["etf"])


@router.post("/{round_id}/etf/{ticker}/operate", response_model=ETFOperateResult)
async def etf_operate(
    round_id: int,
    ticker: str,
    payload: ETFOperateRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    round_ = await db.get(Round, round_id)
    if not round_:
        raise HTTPException(404, "Round not found")
    if round_.status != RoundStatus.ACTIVE:
        raise HTTPException(400, "Round is not active")

    # Find ETF config for this ticker
    etf_cfg = next(
        (tc for tc in round_.tickers_config if tc.get("ticker") == ticker),
        None,
    )
    if not etf_cfg:
        raise HTTPException(404, f"Ticker {ticker} not in this round")
    if not etf_cfg.get("is_etf"):
        raise HTTPException(400, f"{ticker} is not configured as an ETF")

    basket = etf_cfg.get("etf_basket", [])
    if not basket:
        raise HTTPException(400, f"{ticker} has no basket configured")

    # Validate basket tickers are in this round
    round_tickers = {tc["ticker"] for tc in round_.tickers_config}
    for item in basket:
        if item["ticker"] not in round_tickers:
            raise HTTPException(
                400,
                f"Basket ticker {item['ticker']} is not in this round"
            )

    rt = session_manager.get_round_runtime(round_id)
    if not rt:
        raise HTTPException(503, "Round runtime not available")

    # Ensure position slots exist
    for tc in round_.tickers_config:
        rt.register_position(user.id, tc["ticker"])

    try:
        result = rt.etf_operate(
            user_id=user.id,
            etf_ticker=ticker,
            etf_cfg=etf_cfg,
            action=payload.action,
            lots=payload.lots,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))

    # Push updated positions to user via WebSocket
    positions = rt.get_position_snapshot(user.id)
    await ws_manager.send_to_user(round_id, user.id, "position_update", positions)

    return ETFOperateResult(
        action=payload.action,
        lots=payload.lots,
        etf_ticker=ticker,
        etf_quantity_delta=result["etf_qty_delta"],
        basket_deltas=result["basket_deltas"],
        fee=result["fee"],
        positions=positions,
    )


@router.get("/{round_id}/etf/{ticker}/nav")
async def get_etf_nav(
    round_id: int,
    ticker: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """
    Returns the current Net Asset Value (NAV) of one ETF lot based on
    last trade prices of basket components, and the current market mid-price
    of the ETF itself, so clients can calculate the arbitrage spread.
    """
    round_ = await db.get(Round, round_id)
    if not round_:
        raise HTTPException(404, "Round not found")

    etf_cfg = next(
        (tc for tc in round_.tickers_config if tc.get("ticker") == ticker),
        None,
    )
    if not etf_cfg or not etf_cfg.get("is_etf"):
        raise HTTPException(400, f"{ticker} is not an ETF")

    rt = session_manager.get_round_runtime(round_id)
    if not rt:
        raise HTTPException(503, "Round runtime not available")

    basket = etf_cfg.get("etf_basket", [])
    lot_size = etf_cfg.get("etf_lot_size", 10)
    fee = etf_cfg.get("etf_fee", 0.0)

    basket_nav = 0.0
    basket_detail = []
    for item in basket:
        book = rt.books.get(item["ticker"])
        last = book.last_price if book else None
        if last is None:
            # Fall back to mid of best bid/ask
            snap = book.snapshot() if book else None
            if snap and snap["bids"] and snap["asks"]:
                last = (snap["bids"][0]["price"] + snap["asks"][0]["price"]) / 2
        component_value = (last or 0.0) * item["ratio"]
        basket_nav += component_value
        basket_detail.append({
            "ticker": item["ticker"],
            "ratio": item["ratio"],
            "last_price": last,
            "component_value": component_value,
        })

    # ETF market mid
    etf_book = rt.books.get(ticker)
    etf_last = etf_book.last_price if etf_book else None
    etf_snap = etf_book.snapshot() if etf_book else None
    etf_mid = None
    if etf_snap and etf_snap["bids"] and etf_snap["asks"]:
        etf_mid = (etf_snap["bids"][0]["price"] + etf_snap["asks"][0]["price"]) / 2

    etf_market_value = (etf_mid or etf_last or 0.0) * lot_size

    return {
        "etf_ticker": ticker,
        "lot_size": lot_size,
        "fee_per_operation": fee,
        "basket_nav": round(basket_nav, 4),          # fair value of 1 lot's basket
        "etf_market_value": round(etf_market_value, 4),  # market value of lot_size ETF units
        "arb_spread": round(etf_market_value - basket_nav, 4),  # >0 → create arb; <0 → redeem arb
        "create_profitable": etf_market_value - basket_nav > fee,
        "redeem_profitable": basket_nav - etf_market_value > fee,
        "basket_detail": basket_detail,
    }
