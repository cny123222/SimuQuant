"""
Simple symmetric market-making strategy.

Run:
    pip install -e ../
    python mm_simple.py
"""
import asyncio
from simquant import SimuQuantClient, BaseStrategy, OrderBook

HOST = "localhost:8000"
API_KEY = "paste-your-api-key-here"
ROUND_ID = 1

HALF_SPREAD = 0.05   # quote ±5 cents around mid
ORDER_SIZE = 5
MAX_POSITION = 50    # flatten if position exceeds this


class SimpleMMStrategy(BaseStrategy):
    def __init__(self):
        self._active_bids: dict[str, int] = {}   # ticker → order_id
        self._active_asks: dict[str, int] = {}

    async def on_start(self):
        print("Strategy started – waiting for order book data…")

    async def on_orderbook(self, ticker: str, book: OrderBook):
        mid = book.mid
        if mid is None:
            return

        pos = self.get_position(ticker)
        qty = pos.quantity if pos else 0

        # Skew quotes to flatten inventory
        skew = -qty * 0.005  # reduce bid / raise ask when long

        bid_price = round(mid - HALF_SPREAD + skew, 2)
        ask_price = round(mid + HALF_SPREAD + skew, 2)

        # Cancel previous quotes (best-effort)
        for side_dict in (self._active_bids, self._active_asks):
            if ticker in side_dict:
                try:
                    await self.client.cancel_order(side_dict.pop(ticker))
                except Exception:
                    pass

        # Don't quote if too long or too short
        if abs(qty) > MAX_POSITION:
            return

        try:
            bid = await self.buy_limit(ticker, bid_price, ORDER_SIZE)
            self._active_bids[ticker] = bid.id
        except Exception as e:
            print(f"Bid error: {e}")

        try:
            ask = await self.sell_limit(ticker, ask_price, ORDER_SIZE)
            self._active_asks[ticker] = ask.id
        except Exception as e:
            print(f"Ask error: {e}")

    async def on_position_update(self, positions):
        pnl = self.total_pnl()
        pos_str = ", ".join(f"{p.ticker}: {p.quantity:+d} pnl={p.total_pnl:+.2f}" for p in positions)
        print(f"[PnL] {pnl:+.2f}  |  {pos_str}")

    async def on_stop(self):
        print(f"Round finished. Final PnL: {self.total_pnl():+.2f}")


if __name__ == "__main__":
    client = SimuQuantClient(host=HOST, api_key=API_KEY)
    client.run(SimpleMMStrategy(), session_id=1, round_id=ROUND_ID)
