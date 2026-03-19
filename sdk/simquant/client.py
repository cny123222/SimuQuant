"""
SimuQuantClient – async HTTP + WebSocket client for the SimuQuant platform.

Usage:
    client = SimuQuantClient(host="localhost:8000", api_key="your_key")
    await client.connect(round_id=1)
    await client.place_order("AAPL", "BUY", "LIMIT", price=150.0, quantity=10)
    await client.disconnect()
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Callable, Coroutine, Optional

import httpx
import websockets

from .types import Order, OrderBook, Position, PriceLevel, RoundState, Trade

logger = logging.getLogger("simquant.client")


class SimuQuantClient:
    def __init__(self, host: str = "localhost:8000", api_key: str = ""):
        self.host = host.rstrip("/")
        self.api_key = api_key
        self._http = httpx.AsyncClient(
            base_url=f"http://{self.host}/api",
            headers={"X-Api-Key": api_key},
            timeout=10.0,
        )
        self._ws: Optional[websockets.WebSocketClientProtocol] = None
        self._round_id: Optional[int] = None
        self._recv_task: Optional[asyncio.Task] = None

        # latest state
        self.order_books: dict[str, OrderBook] = {}
        self.positions: list[Position] = []
        self.recent_trades: list[Trade] = []
        self.round_state: Optional[RoundState] = None

        # callbacks
        self._on_orderbook: list[Callable] = []
        self._on_trade: list[Callable] = []
        self._on_position: list[Callable] = []
        self._on_round_state: list[Callable] = []

    # ── Event subscription ────────────────────────────────────────────────────

    def on_orderbook(self, fn: Callable) -> Callable:
        self._on_orderbook.append(fn)
        return fn

    def on_trade(self, fn: Callable) -> Callable:
        self._on_trade.append(fn)
        return fn

    def on_position(self, fn: Callable) -> Callable:
        self._on_position.append(fn)
        return fn

    def on_round_state(self, fn: Callable) -> Callable:
        self._on_round_state.append(fn)
        return fn

    # ── WebSocket connection ──────────────────────────────────────────────────

    async def connect(self, round_id: int) -> None:
        self._round_id = round_id
        uri = f"ws://{self.host}/ws/{round_id}?api_key={self.api_key}"
        self._ws = await websockets.connect(uri)
        self._recv_task = asyncio.create_task(self._recv_loop())
        logger.info(f"Connected to round {round_id}")

    async def disconnect(self) -> None:
        if self._recv_task:
            self._recv_task.cancel()
        if self._ws:
            await self._ws.close()

    async def _recv_loop(self) -> None:
        try:
            async for raw in self._ws:  # type: ignore[union-attr]
                try:
                    msg = json.loads(raw)
                    await self._dispatch(msg)
                except Exception as e:
                    logger.debug(f"Dispatch error: {e}")
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.warning(f"WS recv loop ended: {e}")

    async def _dispatch(self, msg: dict) -> None:
        t = msg.get("type")
        data = msg.get("data", {})

        if t == "orderbook_update":
            book = self._parse_orderbook(data)
            self.order_books[book.ticker] = book
            await self._fire(self._on_orderbook, book)

        elif t == "trade":
            from datetime import datetime
            trade = Trade(
                ticker=data["ticker"],
                price=data["price"],
                quantity=data["quantity"],
                aggressor_side=data["aggressor_side"],
                executed_at=datetime.fromisoformat(data["executed_at"]),
            )
            self.recent_trades = [trade] + self.recent_trades[:99]
            await self._fire(self._on_trade, trade)

        elif t == "position_update":
            self.positions = [
                Position(
                    ticker=p["ticker"],
                    quantity=p["quantity"],
                    avg_cost=p["avg_cost"],
                    realized_pnl=p["realized_pnl"],
                    unrealized_pnl=p["unrealized_pnl"],
                    total_pnl=p["total_pnl"],
                )
                for p in data
            ]
            await self._fire(self._on_position, self.positions)

        elif t == "round_state":
            state = RoundState(
                round_id=data["round_id"],
                status=data["status"],
                duration_seconds=data.get("duration_seconds"),
                tickers=data.get("tickers", []),
            )
            self.round_state = state
            await self._fire(self._on_round_state, state)

    @staticmethod
    def _parse_orderbook(data: dict) -> OrderBook:
        from datetime import datetime
        return OrderBook(
            ticker=data["ticker"],
            bids=[PriceLevel(price=b["price"], quantity=b["quantity"]) for b in data.get("bids", [])],
            asks=[PriceLevel(price=a["price"], quantity=a["quantity"]) for a in data.get("asks", [])],
            last_price=data.get("last_price"),
            fair_value=data.get("fair_value"),
            timestamp=datetime.fromisoformat(data["timestamp"]) if data.get("timestamp") else None,
        )

    @staticmethod
    async def _fire(callbacks: list[Callable], *args) -> None:
        for cb in callbacks:
            try:
                result = cb(*args)
                if asyncio.iscoroutine(result):
                    await result
            except Exception as e:
                logger.debug(f"Callback error: {e}")

    # ── HTTP trading API ──────────────────────────────────────────────────────

    async def place_order(
        self,
        ticker: str,
        side: str,
        order_type: str = "LIMIT",
        price: Optional[float] = None,
        quantity: int = 1,
        round_id: Optional[int] = None,
    ) -> Order:
        rid = round_id or self._round_id
        if not rid:
            raise ValueError("Not connected to a round")
        resp = await self._http.post(
            f"/rounds/{rid}/orders",
            json={
                "ticker": ticker,
                "side": side,
                "order_type": order_type,
                "price": price,
                "quantity": quantity,
            },
        )
        resp.raise_for_status()
        d = resp.json()
        from datetime import datetime
        return Order(
            id=d["id"],
            ticker=d["ticker"],
            side=d["side"],
            order_type=d["order_type"],
            price=d.get("price"),
            quantity=d["quantity"],
            filled_quantity=d["filled_quantity"],
            status=d["status"],
            created_at=datetime.fromisoformat(d["created_at"]),
        )

    async def cancel_order(self, order_id: int, round_id: Optional[int] = None) -> Order:
        rid = round_id or self._round_id
        resp = await self._http.delete(f"/rounds/{rid}/orders/{order_id}")
        resp.raise_for_status()
        d = resp.json()
        from datetime import datetime
        return Order(
            id=d["id"],
            ticker=d["ticker"],
            side=d["side"],
            order_type=d["order_type"],
            price=d.get("price"),
            quantity=d["quantity"],
            filled_quantity=d["filled_quantity"],
            status=d["status"],
            created_at=datetime.fromisoformat(d["created_at"]),
        )

    async def get_orders(self, round_id: Optional[int] = None) -> list[Order]:
        rid = round_id or self._round_id
        resp = await self._http.get(f"/rounds/{rid}/orders")
        resp.raise_for_status()
        from datetime import datetime
        return [
            Order(
                id=d["id"],
                ticker=d["ticker"],
                side=d["side"],
                order_type=d["order_type"],
                price=d.get("price"),
                quantity=d["quantity"],
                filled_quantity=d["filled_quantity"],
                status=d["status"],
                created_at=datetime.fromisoformat(d["created_at"]),
            )
            for d in resp.json()
        ]

    async def get_positions(self, round_id: Optional[int] = None) -> list[Position]:
        rid = round_id or self._round_id
        resp = await self._http.get(f"/rounds/{rid}/positions")
        resp.raise_for_status()
        return [
            Position(
                ticker=p["ticker"],
                quantity=p["quantity"],
                avg_cost=p["avg_cost"],
                realized_pnl=p["realized_pnl"],
                unrealized_pnl=p["unrealized_pnl"],
                total_pnl=p["total_pnl"],
            )
            for p in resp.json()
        ]

    async def get_orderbook(self, ticker: str, round_id: Optional[int] = None) -> OrderBook:
        rid = round_id or self._round_id
        resp = await self._http.get(f"/rounds/{rid}/orderbook/{ticker}")
        resp.raise_for_status()
        return self._parse_orderbook(resp.json())

    async def get_me(self) -> dict:
        resp = await self._http.get("/users/me")
        resp.raise_for_status()
        return resp.json()

    # ── Convenience: run a strategy ───────────────────────────────────────────

    def run(self, strategy: "BaseStrategy", session_id: int, round_id: int) -> None:
        """Blocking entry point – run an async strategy until round ends."""
        import asyncio
        strategy.client = self
        asyncio.run(self._run_strategy(strategy, round_id))

    async def _run_strategy(self, strategy: "BaseStrategy", round_id: int) -> None:
        await self.connect(round_id)
        await strategy.on_start()

        stop = asyncio.Event()

        @self.on_round_state
        async def _check_finish(state: RoundState):
            if state.status == "FINISHED":
                stop.set()

        @self.on_orderbook
        async def _ob(book: OrderBook):
            await strategy.on_orderbook(book.ticker, book)

        @self.on_trade
        async def _tr(trade: Trade):
            await strategy.on_trade(trade)

        @self.on_position
        async def _pos(positions: list[Position]):
            await strategy.on_position_update(positions)

        await stop.wait()
        await strategy.on_stop()
        await self.disconnect()
