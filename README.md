# SimuQuant — Market-Making Simulation Platform

A full-stack quantitative trading simulation platform inspired by Optiver and Jump Trading market-making games.
Participants connect via a Python SDK, write automated strategies, and compete in real-time order-book markets
driven by GBM price simulation and liquidity bots.

---

## Architecture

```
SimuQuant/
├── backend/          FastAPI server – matching engine, REST API, WebSocket, bots
├── frontend/         React + TypeScript UI – order book, charts, PnL, admin panel
├── sdk/              Python SDK – SimuQuantClient + BaseStrategy for user strategies
└── docker-compose.yml
```

---

## Quick Start (Docker)

```bash
# 1. Build and start everything
docker-compose up --build

# 2. On first startup the admin API key is printed in the backend logs:
#    ================================================
#    Admin created: username=admin
#    API Key: <your-admin-key>
#    ================================================

# 3. Open the UI
open http://localhost:3000
```

---

## Quick Start (Local Development)

### Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
# Admin key printed on first run
```

### Frontend

```bash
cd frontend
npm install
npm run dev
# Opens at http://localhost:5173
```

### Python SDK

```bash
cd sdk
pip install -e .
```

---

## Setting Up a Game

### 1. Login as Admin

Open `http://localhost:3000`, enter the admin API key from the backend logs.

### 2. Create a Session

In the Admin panel → Sessions → **Create Session**.

### 3. Add a Round

Click a session → **+ Add Round**, configure:

| Field | Description |
|---|---|
| Duration | Round length in seconds (e.g. 180) |
| Tickers | Add 1-3 tickers with initial price, volatility σ, drift μ, jump λ |
| MM Bots | Number of market-maker bots (provide two-sided quotes) |
| Noise Bots | Number of noise traders (random market orders) |
| MM Spread | Half-spread for bot quotes (e.g. 0.10) |
| Order Size | Bot order size per quote |

### 4. Create Trader Accounts

Admin panel → **Users** → Create users. Give each trader their API key.

### 5. Start the Round

Click **Start** next to the round. Traders can now connect.

---

## Connecting with the Python SDK

### Install

```bash
pip install -e sdk/
```

### Minimal strategy

```python
from simquant import SimuQuantClient, BaseStrategy, OrderBook

class MyStrategy(BaseStrategy):
    async def on_orderbook(self, ticker: str, book: OrderBook):
        mid = book.mid
        if mid is None:
            return
        await self.buy_limit(ticker, round(mid - 0.05, 2), 10)
        await self.sell_limit(ticker, round(mid + 0.05, 2), 10)

    async def on_position_update(self, positions):
        print(f"PnL: {self.total_pnl():+.2f}")

client = SimuQuantClient(host="localhost:8000", api_key="YOUR_API_KEY")
client.run(MyStrategy(), session_id=1, round_id=1)
```

### BaseStrategy callbacks

| Method | Triggered when |
|---|---|
| `on_start()` | Connected to the round |
| `on_orderbook(ticker, book)` | Order book update (~0.5s tick per ticker) |
| `on_trade(trade)` | Any trade executes in the market |
| `on_position_update(positions)` | Your fill changes your position |
| `on_round_state(state)` | Round starts or finishes |
| `on_stop()` | Round ends |

### OrderBook properties

```python
book.best_bid    # float | None
book.best_ask    # float | None
book.mid         # (bid + ask) / 2
book.spread      # ask - bid
book.fair_value  # simulator's GBM fair value (not market price)
book.bids        # list[PriceLevel] – best bid first
book.asks        # list[PriceLevel] – best ask first
```

### Placing orders

```python
# Limit orders
await self.buy_limit(ticker, price, quantity)
await self.sell_limit(ticker, price, quantity)

# Market orders
await self.buy_market(ticker, quantity)
await self.sell_market(ticker, quantity)

# Cancel
await self.client.cancel_order(order_id)
```

### Position helpers

```python
pos = self.get_position("AAPL")
pos.quantity        # signed inventory
pos.avg_cost        # average fill price
pos.realized_pnl    # closed PnL
pos.unrealized_pnl  # mark-to-market PnL
pos.total_pnl       # realized + unrealized

self.total_pnl()    # sum across all tickers
```

---

## WebSocket Events (for custom clients)

Connect to `ws://<host>/ws/<round_id>?api_key=<key>`

| Event type | Payload |
|---|---|
| `orderbook_update` | `{ticker, bids, asks, last_price, fair_value, timestamp}` |
| `trade` | `{ticker, price, quantity, aggressor_side, executed_at}` |
| `position_update` | `[{ticker, quantity, avg_cost, realized_pnl, unrealized_pnl, total_pnl}]` |
| `round_state` | `{round_id, status, duration_seconds?, tickers?}` |

---

## REST API

All endpoints require `X-Api-Key: <key>` header. Admin-only endpoints are marked with `[admin]`.

```
GET    /api/health
GET    /api/users/me
POST   /api/users                         [admin]
GET    /api/users                         [admin]

POST   /api/sessions                      [admin]
GET    /api/sessions
GET    /api/sessions/{id}
POST   /api/sessions/{id}/rounds          [admin]
GET    /api/sessions/{id}/rounds
POST   /api/sessions/{id}/rounds/{r}/start   [admin]
POST   /api/sessions/{id}/rounds/{r}/finish  [admin]

POST   /api/rounds/{id}/orders
DELETE /api/rounds/{id}/orders/{oid}
GET    /api/rounds/{id}/orders
GET    /api/rounds/{id}/trades
GET    /api/rounds/{id}/orderbook/{ticker}
GET    /api/rounds/{id}/positions
GET    /api/rounds/{id}/price-history/{ticker}
GET    /api/rounds/{id}/leaderboard
```

Full interactive docs: `http://localhost:8000/docs`

---

## Example Strategies

| File | Description |
|---|---|
| `sdk/examples/mm_simple.py` | Symmetric market-maker with inventory skew |
| `sdk/examples/arb_example.py` | Fair-value arbitrage (buy underpriced, sell overpriced) |
