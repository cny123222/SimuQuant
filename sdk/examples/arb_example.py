"""
Simple fair-value arbitrage strategy.

Compares the current market mid to the fair_value broadcast by the simulator.
If mid deviates > threshold, trade against it.

Run:
    python arb_example.py
"""
from simquant import SimuQuantClient, BaseStrategy, OrderBook

HOST = "localhost:8000"
API_KEY = "paste-your-api-key-here"
ROUND_ID = 1

THRESHOLD = 0.08   # fair-value deviation to trigger a trade
ORDER_SIZE = 3


class FairValueArb(BaseStrategy):
    async def on_orderbook(self, ticker: str, book: OrderBook):
        if book.fair_value is None or book.mid is None:
            return

        deviation = book.mid - book.fair_value

        if deviation > THRESHOLD:
            # Market overpriced – sell
            try:
                await self.sell_market(ticker, ORDER_SIZE)
                print(f"[ARB] SELL {ORDER_SIZE} {ticker} @ market | mid={book.mid:.2f} fv={book.fair_value:.2f}")
            except Exception as e:
                print(f"Sell error: {e}")

        elif deviation < -THRESHOLD:
            # Market underpriced – buy
            try:
                await self.buy_market(ticker, ORDER_SIZE)
                print(f"[ARB] BUY  {ORDER_SIZE} {ticker} @ market | mid={book.mid:.2f} fv={book.fair_value:.2f}")
            except Exception as e:
                print(f"Buy error: {e}")

    async def on_position_update(self, positions):
        pnl = self.total_pnl()
        print(f"[PnL] Total: {pnl:+.2f}")

    async def on_stop(self):
        print(f"Done. Final PnL: {self.total_pnl():+.2f}")


if __name__ == "__main__":
    client = SimuQuantClient(host=HOST, api_key=API_KEY)
    client.run(FairValueArb(), session_id=1, round_id=ROUND_ID)
