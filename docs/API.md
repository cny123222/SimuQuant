# SimuQuant API 参考文档

> 版本 0.1.0 · Base URL: `http://localhost:8000`
>
> 交互式文档（Swagger UI）：`http://localhost:8000/docs`

---

## 认证

所有 API（除健康检查外）均需在请求头中携带 API Key：

```
X-Api-Key: <your_api_key>
```

- **普通用户**：可查询市场数据、下单、查看自己的持仓
- **管理员**：额外拥有创建 Session/Round/User 的权限

管理员 API Key 在后端**首次启动**时打印到控制台。

---

## 目录

- [健康检查](#健康检查)
- [用户管理](#用户管理)
- [Session 管理](#session-管理)
- [Round 管理](#round-管理)
- [订单操作](#订单操作)
- [市场数据](#市场数据)
- [WebSocket 实时推送](#websocket-实时推送)
- [Python SDK](#python-sdk)
- [错误码](#错误码)
- [数据类型参考](#数据类型参考)

---

## 健康检查

### GET /api/health

检查服务是否正常运行。

**无需认证**

**响应 200**

```json
{
  "status": "ok",
  "service": "SimuQuant"
}
```

---

## 用户管理

### GET /api/users/me

获取当前认证用户的信息。

**响应 200**

```json
{
  "id": 2,
  "username": "alice",
  "api_key": "875b667b0b9c665ccb61c747bf12c5f6e8929d87724682a4",
  "is_admin": false,
  "created_at": "2026-03-19T12:58:17.903478"
}
```

---

### POST /api/users `[管理员]`

创建新交易员账户。

**请求体**

```json
{
  "username": "alice"
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `username` | string | ✓ | 用户名，全局唯一 |

**响应 200**

```json
{
  "id": 2,
  "username": "alice",
  "api_key": "875b667b0b9c665ccb61c747bf12c5f6e8929d87724682a4",
  "is_admin": false,
  "created_at": "2026-03-19T12:58:17.903478"
}
```

> ⚠️ `api_key` 只在创建时返回一次，请妥善保存并分发给对应交易员。

---

### GET /api/users `[管理员]`

列出所有用户。

**响应 200**

```json
[
  {
    "id": 1,
    "username": "admin",
    "api_key": "...",
    "is_admin": true,
    "created_at": "2026-03-19T12:00:00"
  }
]
```

---

## Session 管理

Session 是一场游戏的容器，包含多个 Round。

### POST /api/sessions `[管理员]`

创建新 Session。

**请求体**

```json
{
  "name": "北京赛区决赛"
}
```

**响应 200**

```json
{
  "id": 1,
  "name": "北京赛区决赛",
  "status": "PENDING",
  "created_at": "2026-03-19T10:00:00",
  "started_at": null,
  "finished_at": null
}
```

---

### GET /api/sessions

列出所有 Session（按创建时间倒序）。

**响应 200**：Session 对象数组，结构同上。

---

### GET /api/sessions/{session_id}

获取单个 Session 详情。

**路径参数**：`session_id` — Session ID

**响应 200**：Session 对象

---

## Round 管理

Round 是实际的交易轮次，在 Round 内买卖股票。

### POST /api/sessions/{session_id}/rounds `[管理员]`

在指定 Session 下创建 Round。

**路径参数**：`session_id` — Session ID

**请求体**

```json
{
  "round_number": 1,
  "name": "Round 1 - 热身",
  "duration_seconds": 180,
  "tickers_config": [
    {
      "ticker": "AAPL",
      "initial_price": 150.0,
      "volatility": 0.02,
      "drift": 0.0,
      "jump_intensity": 0.01,
      "jump_size": 0.05
    },
    {
      "ticker": "TSLA",
      "initial_price": 200.0,
      "volatility": 0.03,
      "drift": 0.0,
      "jump_intensity": 0.02,
      "jump_size": 0.08
    }
  ],
  "mm_bot_count": 3,
  "noise_bot_count": 2,
  "mm_spread": 0.10,
  "mm_order_size": 10
}
```

**请求字段说明**

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `round_number` | int | — | Round 编号（同 Session 内唯一） |
| `name` | string | null | Round 名称（可选） |
| `duration_seconds` | int | 180 | Round 持续时长（秒） |
| `tickers_config` | array | — | 股票配置列表，见下方 |
| `mm_bot_count` | int | 3 | 每个 ticker 的做市 bot 数量 |
| `noise_bot_count` | int | 2 | 每个 ticker 的噪声交易 bot 数量 |
| `mm_spread` | float | 0.10 | 做市 bot 的半价差（美元），bot 在 fv±spread/2 报价 |
| `mm_order_size` | int | 10 | 做市 bot 每档报价的数量 |

**TickerConfig 字段**

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `ticker` | string | — | 股票代码（如 "AAPL"） |
| `initial_price` | float | 100.0 | 初始 fair value（美元） |
| `volatility` | float | 0.02 | 每 tick 的 GBM 波动率 σ |
| `drift` | float | 0.0 | 每 tick 的漂移 μ（正值 = 上涨趋势） |
| `jump_intensity` | float | 0.01 | 每 tick 发生价格跳跃的概率 |
| `jump_size` | float | 0.05 | 跳跃幅度上界（±5%） |

**响应 200**：Round 对象

---

### GET /api/sessions/{session_id}/rounds

列出指定 Session 下的所有 Round。

**响应 200**：Round 对象数组

---

### GET /api/sessions/{session_id}/rounds/{round_id}

获取单个 Round 详情。

**响应 200**：Round 对象

---

### POST /api/sessions/{session_id}/rounds/{round_id}/start `[管理员]`

启动 Round。

启动后：
- Round 状态变为 `ACTIVE`
- 做市 bot 和噪声 bot 开始运行
- GBM 价格模拟器开始 tick
- 所有 WS 订阅者收到 `round_state` 事件
- `duration_seconds` 后自动结束 Round

**响应 200**：更新后的 Round 对象（`status: "ACTIVE"`）

---

### POST /api/sessions/{session_id}/rounds/{round_id}/finish `[管理员]`

手动提前结束 Round。

**响应 200**：更新后的 Round 对象（`status: "FINISHED"`）

---

## 订单操作

### POST /api/rounds/{round_id}/orders

下单。Round 必须处于 `ACTIVE` 状态。

**路径参数**：`round_id` — Round ID

**请求体**

```json
{
  "ticker": "AAPL",
  "side": "BUY",
  "order_type": "LIMIT",
  "price": 149.90,
  "quantity": 10
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `ticker` | string | ✓ | 股票代码，必须在本 Round 的 tickers_config 中 |
| `side` | `"BUY"` \| `"SELL"` | ✓ | 买卖方向 |
| `order_type` | `"LIMIT"` \| `"MARKET"` | ✓ | 订单类型 |
| `price` | float | LIMIT 必填 | 限价单价格（美元） |
| `quantity` | int | ✓ | 数量，必须 > 0 |

**响应 200**

```json
{
  "id": 42,
  "round_id": 1,
  "user_id": 2,
  "ticker": "AAPL",
  "side": "BUY",
  "order_type": "LIMIT",
  "price": 149.90,
  "quantity": 10,
  "filled_quantity": 5,
  "status": "PARTIAL",
  "created_at": "2026-03-19T13:00:00.123456"
}
```

**订单状态**

| 状态 | 含义 |
|---|---|
| `OPEN` | 挂单中，未成交 |
| `PARTIAL` | 部分成交，剩余在 book 中 |
| `FILLED` | 全部成交 |
| `CANCELLED` | 已撤单（或 MARKET 单无法成交） |

---

### DELETE /api/rounds/{round_id}/orders/{order_id}

撤单。只能撤自己的、状态为 `OPEN` 或 `PARTIAL` 的订单。

**响应 200**：更新后的 Order 对象（`status: "CANCELLED"`）

---

### GET /api/rounds/{round_id}/orders

查询当前 Round 中自己的所有订单（按创建时间倒序）。

**响应 200**：Order 对象数组

---

### GET /api/rounds/{round_id}/trades

查询当前 Round 最近 200 条公开成交记录。

**响应 200**

```json
[
  {
    "id": 15,
    "round_id": 1,
    "ticker": "AAPL",
    "price": 153.83,
    "quantity": 3,
    "aggressor_side": "BUY",
    "executed_at": "2026-03-19T13:00:05.000000"
  }
]
```

| 字段 | 说明 |
|---|---|
| `aggressor_side` | 主动方方向（主动 BUY = 吃 ask，主动 SELL = 吃 bid） |

---

## 市场数据

### GET /api/rounds/{round_id}/orderbook/{ticker}

获取当前 Order Book 快照（5 档）。

**路径参数**：`round_id`、`ticker`

**查询参数**：`depth`（默认 5，返回档位数量）

**响应 200**

```json
{
  "ticker": "AAPL",
  "bids": [
    {"price": 153.74, "quantity": 10},
    {"price": 153.64, "quantity": 20}
  ],
  "asks": [
    {"price": 153.83, "quantity": 10},
    {"price": 153.93, "quantity": 10}
  ],
  "timestamp": "2026-03-19T13:00:10.000000"
}
```

> `bids` 按价格从高到低排列（best bid 在前），`asks` 按价格从低到高排列（best ask 在前）。

---

### GET /api/rounds/{round_id}/positions

获取当前 Round 中自己的实时持仓和 PnL。

**响应 200**

```json
[
  {
    "ticker": "AAPL",
    "quantity": 15,
    "avg_cost": 153.20,
    "realized_pnl": 12.50,
    "unrealized_pnl": 8.25,
    "total_pnl": 20.75
  }
]
```

| 字段 | 说明 |
|---|---|
| `quantity` | 持仓数量（正数 = 多仓，负数 = 空仓，0 = 无仓位） |
| `avg_cost` | 加权平均成本价 |
| `realized_pnl` | 已实现 PnL（平仓部分） |
| `unrealized_pnl` | 浮动 PnL（以 last_price 估值） |
| `total_pnl` | realized + unrealized |

---

### GET /api/rounds/{round_id}/price-history/{ticker}

获取当前 Round 的 fair value 历史（最近 500 个点）。

**响应 200**

```json
[
  {"timestamp": "2026-03-19T13:00:00.500000", "price": 150.12},
  {"timestamp": "2026-03-19T13:00:01.000000", "price": 150.34}
]
```

---

### GET /api/rounds/{round_id}/leaderboard

获取当前 Round 的实时排行榜（按 total_pnl 降序）。

**响应 200**

```json
[
  {
    "rank": 1,
    "username": "alice",
    "total_pnl": 142.50,
    "realized_pnl": 80.00,
    "unrealized_pnl": 62.50
  },
  {
    "rank": 2,
    "username": "bob",
    "total_pnl": -23.10,
    "realized_pnl": -10.00,
    "unrealized_pnl": -13.10
  }
]
```

---

## WebSocket 实时推送

### 连接

```
ws://<host>/ws/{round_id}?api_key=<your_api_key>
```

连接建立后立即收到该 Round 当前的 orderbook 快照和自己的持仓数据。

**心跳**：发送 `{"action": "ping"}` 可触发 `{"type": "pong"}` 响应。

---

### 事件：orderbook_update

每约 0.5 秒推送一次（每个 ticker 独立触发）。

```json
{
  "type": "orderbook_update",
  "data": {
    "ticker": "AAPL",
    "bids": [
      {"price": 153.74, "quantity": 10},
      {"price": 153.64, "quantity": 20}
    ],
    "asks": [
      {"price": 153.83, "quantity": 10},
      {"price": 153.93, "quantity": 10}
    ],
    "last_price": 153.83,
    "fair_value": 154.20,
    "timestamp": "2026-03-19T13:00:10.000000"
  }
}
```

| 字段 | 说明 |
|---|---|
| `last_price` | 最近一次成交价，首次推送前为 null |
| `fair_value` | GBM 模拟器当前 fair value，可用于套利参考 |

---

### 事件：trade

每次撮合成交时广播给该 Round 所有订阅者。

```json
{
  "type": "trade",
  "data": {
    "ticker": "AAPL",
    "price": 153.83,
    "quantity": 3,
    "aggressor_side": "BUY",
    "executed_at": "2026-03-19T13:00:05.123456"
  }
}
```

---

### 事件：position_update

**仅推送给成交涉及的用户**（买方或卖方）。每次有涉及自己的成交后触发。

```json
{
  "type": "position_update",
  "data": [
    {
      "ticker": "AAPL",
      "quantity": 18,
      "avg_cost": 153.41,
      "realized_pnl": 0.0,
      "unrealized_pnl": 7.56,
      "total_pnl": 7.56
    }
  ]
}
```

---

### 事件：round_state

Round 启动或结束时广播给所有订阅者。

**Round 启动**

```json
{
  "type": "round_state",
  "data": {
    "round_id": 1,
    "status": "ACTIVE",
    "duration_seconds": 180,
    "tickers": ["AAPL", "TSLA"]
  }
}
```

**Round 结束**

```json
{
  "type": "round_state",
  "data": {
    "round_id": 1,
    "status": "FINISHED"
  }
}
```

---

## Python SDK

### 安装

```bash
pip install -e SimuQuant/sdk/
```

---

### SimuQuantClient

```python
from simquant import SimuQuantClient

client = SimuQuantClient(host="localhost:8000", api_key="your_key")
```

#### 连接与断开

```python
await client.connect(round_id=1)    # 建立 WebSocket 连接
await client.disconnect()           # 关闭连接
```

#### 下单

```python
order = await client.place_order(
    ticker="AAPL",
    side="BUY",            # "BUY" | "SELL"
    order_type="LIMIT",    # "LIMIT" | "MARKET"
    price=149.90,          # LIMIT 必填，MARKET 不填
    quantity=10,
    round_id=1,            # 可选，默认使用已连接的 round_id
)
# order: Order 对象
```

#### 撤单

```python
order = await client.cancel_order(order_id=42)
```

#### 查询

```python
orders    = await client.get_orders()           # 自己的订单
positions = await client.get_positions()        # 自己的持仓
book      = await client.get_orderbook("AAPL") # orderbook 快照
me        = await client.get_me()              # 自己的用户信息
```

#### 事件回调注册

```python
@client.on_orderbook
async def handler(book: OrderBook):
    print(f"{book.ticker} mid={book.mid:.2f}")

@client.on_trade
async def handler(trade: Trade):
    print(f"Trade: {trade.ticker} {trade.price}")

@client.on_position
async def handler(positions: list[Position]):
    print(f"PnL: {sum(p.total_pnl for p in positions):.2f}")

@client.on_round_state
async def handler(state: RoundState):
    if state.status == "FINISHED":
        print("Round ended!")
```

---

### BaseStrategy

继承 `BaseStrategy` 并重写所需方法，是编写自动化策略的推荐方式。

```python
from simquant import SimuQuantClient, BaseStrategy, OrderBook, Trade, Position, RoundState

class MyStrategy(BaseStrategy):
    # ── 生命周期 ────────────────────────────────
    async def on_start(self) -> None:
        """连接成功时调用一次"""
        print("Strategy started")

    async def on_stop(self) -> None:
        """Round 结束时调用一次"""
        print(f"Final PnL: {self.total_pnl():+.2f}")

    # ── 市场事件 ────────────────────────────────
    async def on_orderbook(self, ticker: str, book: OrderBook) -> None:
        """每 ~0.5s 调用一次（每个 ticker 独立）"""
        pass

    async def on_trade(self, trade: Trade) -> None:
        """市场每次成交时调用"""
        pass

    async def on_position_update(self, positions: list[Position]) -> None:
        """自己有成交时调用"""
        pass

    async def on_round_state(self, state: RoundState) -> None:
        """Round 开始/结束时调用"""
        pass
```

#### 便捷下单方法（在 on_* 内使用）

```python
# 返回 Order 对象
await self.buy_limit(ticker, price, quantity)
await self.sell_limit(ticker, price, quantity)
await self.buy_market(ticker, quantity)
await self.sell_market(ticker, quantity)

# 撤单
await self.client.cancel_order(order_id)
```

#### 持仓辅助方法

```python
pos = self.get_position("AAPL")   # Position | None
pos.quantity        # int, 正=多仓, 负=空仓
pos.avg_cost        # float, 加权平均成本
pos.realized_pnl    # float
pos.unrealized_pnl  # float
pos.total_pnl       # float

self.total_pnl()    # float, 所有 ticker 的 total_pnl 之和
```

#### 运行策略

```python
client = SimuQuantClient(host="localhost:8000", api_key="YOUR_KEY")
client.run(MyStrategy(), session_id=1, round_id=2)
# 阻塞直到 Round 结束
```

---

### OrderBook 数据结构

```python
book.ticker       # str, 股票代码
book.bids         # list[PriceLevel], best bid first
book.asks         # list[PriceLevel], best ask first
book.best_bid     # float | None
book.best_ask     # float | None
book.mid          # float | None, (best_bid + best_ask) / 2
book.spread       # float | None, best_ask - best_bid
book.last_price   # float | None, 最近成交价
book.fair_value   # float | None, GBM 模拟器 fair value
book.timestamp    # datetime | None

# PriceLevel
level.price       # float
level.quantity    # int
```

---

### 完整策略示例

#### 做市策略（含 inventory skew）

```python
from simquant import SimuQuantClient, BaseStrategy, OrderBook

class MarketMaker(BaseStrategy):
    def __init__(self, spread=0.05, max_size=50):
        self.spread = spread
        self.max_size = max_size
        self._bids = {}   # ticker → order_id
        self._asks = {}

    async def on_orderbook(self, ticker, book):
        mid = book.mid
        if not mid:
            return

        # 根据持仓偏斜报价
        pos = self.get_position(ticker)
        qty = pos.quantity if pos else 0
        skew = -qty * 0.003  # 多仓时降低 bid 抬高 ask

        bid_p = round(mid - self.spread + skew, 2)
        ask_p = round(mid + self.spread + skew, 2)

        # 撤旧单
        for d in (self._bids, self._asks):
            if ticker in d:
                try:
                    await self.client.cancel_order(d.pop(ticker))
                except:
                    pass

        if abs(qty) > self.max_size:
            return  # 仓位过大，停止报价

        try:
            b = await self.buy_limit(ticker, bid_p, 5)
            self._bids[ticker] = b.id
            a = await self.sell_limit(ticker, ask_p, 5)
            self._asks[ticker] = a.id
        except Exception as e:
            print(f"Order error: {e}")

    async def on_stop(self):
        print(f"Done! PnL = {self.total_pnl():+.2f}")


client = SimuQuantClient(host="localhost:8000", api_key="YOUR_KEY")
client.run(MarketMaker(), session_id=1, round_id=1)
```

#### 套利策略（fair value 偏离）

```python
from simquant import SimuQuantClient, BaseStrategy, OrderBook

class FairValueArb(BaseStrategy):
    THRESHOLD = 0.08
    SIZE = 3

    async def on_orderbook(self, ticker, book):
        if book.fair_value is None or book.mid is None:
            return
        dev = book.mid - book.fair_value

        if dev > self.THRESHOLD:
            try:
                await self.sell_market(ticker, self.SIZE)
            except:
                pass
        elif dev < -self.THRESHOLD:
            try:
                await self.buy_market(ticker, self.SIZE)
            except:
                pass

client = SimuQuantClient(host="localhost:8000", api_key="YOUR_KEY")
client.run(FairValueArb(), session_id=1, round_id=1)
```

---

## 错误码

| HTTP 状态码 | 含义 | 常见原因 |
|---|---|---|
| 200 | 成功 | — |
| 400 | 请求参数错误 | 数量 ≤ 0、LIMIT 单未填 price、Round 不在 ACTIVE 状态 |
| 401 | 未认证 | 未携带 X-Api-Key 或 Key 无效 |
| 403 | 权限不足 | 非管理员操作管理员接口；撤他人订单 |
| 404 | 资源不存在 | Session/Round/Order ID 错误 |
| 503 | 服务不可用 | Round 的内存运行时不存在（Round 未启动或已结束） |

**错误响应格式**

```json
{
  "detail": "Round is not active"
}
```

---

## 数据类型参考

### Session

```json
{
  "id": 1,
  "name": "string",
  "status": "PENDING | ACTIVE | FINISHED",
  "created_at": "ISO8601",
  "started_at": "ISO8601 | null",
  "finished_at": "ISO8601 | null"
}
```

### Round

```json
{
  "id": 1,
  "session_id": 1,
  "round_number": 1,
  "name": "string | null",
  "status": "PENDING | ACTIVE | FINISHED",
  "duration_seconds": 180,
  "tickers_config": [TickerConfig],
  "mm_bot_count": 3,
  "noise_bot_count": 2,
  "mm_spread": 0.10,
  "mm_order_size": 10,
  "started_at": "ISO8601 | null",
  "finished_at": "ISO8601 | null"
}
```

### Order

```json
{
  "id": 42,
  "round_id": 1,
  "user_id": 2,
  "ticker": "AAPL",
  "side": "BUY | SELL",
  "order_type": "LIMIT | MARKET",
  "price": 149.90,
  "quantity": 10,
  "filled_quantity": 5,
  "status": "OPEN | PARTIAL | FILLED | CANCELLED",
  "created_at": "ISO8601"
}
```

### Position

```json
{
  "ticker": "AAPL",
  "quantity": 15,
  "avg_cost": 153.20,
  "realized_pnl": 12.50,
  "unrealized_pnl": 8.25,
  "total_pnl": 20.75
}
```

### Trade

```json
{
  "id": 15,
  "round_id": 1,
  "ticker": "AAPL",
  "price": 153.83,
  "quantity": 3,
  "aggressor_side": "BUY | SELL",
  "executed_at": "ISO8601"
}
```

### LeaderboardEntry

```json
{
  "rank": 1,
  "username": "alice",
  "total_pnl": 142.50,
  "realized_pnl": 80.00,
  "unrealized_pnl": 62.50
}
```
