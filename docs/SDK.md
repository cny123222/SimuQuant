# SimuQuant Python SDK — 用户手册

> 适用对象：参与模拟交易的选手，使用 Python 编写自动交易策略

---

## 目录

1. [安装](#1-安装)
2. [快速开始：30 行完成一个策略](#2-快速开始30-行完成一个策略)
3. [核心概念](#3-核心概念)
4. [SimuQuantClient — 客户端](#4-simucquantclient--客户端)
   - [初始化](#41-初始化)
   - [连接与断开](#42-连接与断开)
   - [下单操作](#43-下单操作)
   - [查询方法](#44-查询方法)
   - [实时状态属性](#45-实时状态属性)
5. [BaseStrategy — 策略基类](#5-basestrategy--策略基类)
   - [生命周期回调](#51-生命周期回调)
   - [市场事件回调](#52-市场事件回调)
   - [便捷交易方法](#53-便捷交易方法)
   - [便捷查询方法](#54-便捷查询方法)
6. [数据类型](#6-数据类型)
   - [OrderBook](#61-orderbook)
   - [Order](#62-order)
   - [Position](#63-position)
   - [Trade](#64-trade)
   - [RoundState](#65-roundstate)
7. [WebSocket 事件](#6-websocket-事件)
8. [ETF 申购赎回](#8-etf-申购赎回)
9. [完整策略示例](#9-完整策略示例)
   - [示例 1：简单做市策略（带库存管理）](#91-示例-1简单做市策略带库存管理)
   - [示例 2：公允价值套利](#92-示例-2公允价值套利)
   - [示例 3：双品种价差套利（Round 3 场景）](#93-示例-3双品种价差套利round-3-场景)
   - [示例 4：ETF 篮子套利（Round 4 场景）](#94-示例-4etf-篮子套利round-4-场景)
10. [常见错误与处理](#10-常见错误与处理)
11. [策略编写最佳实践](#11-策略编写最佳实践)

---

## 1. 安装

```bash
# 进入 SDK 目录
cd SimuQuant/sdk

# 以可编辑模式安装（推荐，方便修改）
pip install -e .

# 依赖项（自动安装）
# httpx >= 0.27  — 异步 HTTP 客户端
# websockets >= 12.0  — WebSocket 客户端
```

验证安装：

```python
from simquant import SimuQuantClient, BaseStrategy
print("安装成功")
```

---

## 2. 快速开始：30 行完成一个策略

```python
from simquant import SimuQuantClient, BaseStrategy, OrderBook

class MyStrategy(BaseStrategy):

    async def on_start(self):
        print("连接成功，开始交易！")

    async def on_orderbook(self, ticker: str, book: OrderBook):
        # 每次订单簿更新时调用（约每 0.5 秒）
        mid = book.mid
        if mid is None:
            return

        # 在中间价 ±0.05 挂做市商双边报价
        await self.buy_limit(ticker, round(mid - 0.05, 2), 5)
        await self.sell_limit(ticker, round(mid + 0.05, 2), 5)

    async def on_position_update(self, positions):
        print(f"当前 PnL: {self.total_pnl():+.2f}")

    async def on_stop(self):
        print(f"Round 结束，最终 PnL: {self.total_pnl():+.2f}")


if __name__ == "__main__":
    client = SimuQuantClient(
        host="localhost:8000",
        api_key="your-api-key-here",
    )
    client.run(MyStrategy(), session_id=1, round_id=1)
```

运行：

```bash
python my_strategy.py
```

---

## 3. 核心概念

### 运行模式

SDK 有两种使用方式：

**方式 A — 策略模式（推荐）**

继承 `BaseStrategy`，重写事件回调，由 `client.run()` 统一驱动：

```python
client.run(MyStrategy(), session_id=1, round_id=1)
```

- `run()` 是**阻塞调用**，直到 Round 结束后返回
- 事件驱动：每次行情更新、成交、仓位变化都会自动触发对应回调
- `client` 自动注入到 `strategy.client`

**方式 B — 直接调用（灵活模式）**

直接使用 `SimuQuantClient` 的方法，自己管理 async 循环：

```python
async def main():
    client = SimuQuantClient(host="localhost:8000", api_key="xxx")
    await client.connect(round_id=1)

    book = await client.get_orderbook("PRODA")
    order = await client.place_order("PRODA", "BUY", "LIMIT", price=99.9, quantity=5)

    await client.disconnect()

asyncio.run(main())
```

---

## 4. SimuQuantClient — 客户端

### 4.1 初始化

```python
client = SimuQuantClient(
    host="localhost:8000",   # 服务器地址（不含 http://）
    api_key="your-key",      # 你的 API Key
)
```

---

### 4.2 连接与断开

```python
await client.connect(round_id=1)    # 建立 WebSocket 连接，开始接收行情
await client.disconnect()           # 关闭连接
```

连接成功后，服务器会立即推送：
- 所有品种的当前订单簿快照
- 你的当前仓位快照

---

### 4.3 下单操作

#### `place_order` — 下单

```python
order = await client.place_order(
    ticker="PRODA",        # 品种代码
    side="BUY",            # "BUY" 或 "SELL"
    order_type="LIMIT",    # "LIMIT"（默认）| "MARKET" | "IOC"
    price=99.95,           # 价格（MARKET 不需要）
    quantity=10,           # 数量
)
```

返回 `Order` 对象，含 `order.id`（用于撤单）和 `order.status`。

**三种订单类型区别：**

| 类型 | 行为 |
|---|---|
| `LIMIT` | 挂单：以指定价格或更优价格成交，未成交部分保留在订单簿等待 |
| `MARKET` | 市价单：立即以当前最优价格成交，无论价格如何 |
| `IOC` | 即时或撤销：以指定价格尝试立即成交，未成交部分直接取消（不挂单） |

---

#### `cancel_order` — 撤单

```python
cancelled = await client.cancel_order(order_id=42)
```

只能撤销自己的、状态为 `OPEN` 或 `PARTIAL` 的订单。

---

### 4.4 查询方法

#### 获取订单簿

```python
book = await client.get_orderbook("PRODA")
# book.bids = [PriceLevel(price=99.9, quantity=20), ...]
# book.asks = [PriceLevel(price=100.1, quantity=15), ...]
# book.best_bid, book.best_ask, book.mid, book.spread
```

> **提示：** 通过 WebSocket 事件接收订单簿更新（`on_orderbook` 回调）比轮询 REST API 更高效，不占用速率限制配额。

---

#### 查看我的订单

```python
orders = await client.get_orders()
for o in orders:
    print(f"{o.id}: {o.side} {o.quantity} {o.ticker} @ {o.price} — {o.status}")
```

---

#### 查看我的仓位

```python
positions = await client.get_positions()
for p in positions:
    print(f"{p.ticker}: qty={p.quantity}, avg_cost={p.avg_cost:.2f}, pnl={p.total_pnl:+.2f}")
```

---

#### 查看我的账户信息

```python
me = await client.get_me()
# {"id": 2, "username": "alice", "is_admin": false, ...}
```

---

### 4.5 实时状态属性

WebSocket 连接期间，以下属性由客户端自动维护，随时可读：

```python
client.order_books   # dict[ticker, OrderBook] — 所有品种的最新订单簿
client.positions     # list[Position] — 我的最新仓位（WS 推送更新）
client.recent_trades # list[Trade] — 最近 100 笔成交
client.round_state   # RoundState | None — 当前 Round 状态
```

在策略回调中，直接使用 `self.client.order_books["PRODA"]` 即可获取当前快照。

---

## 5. BaseStrategy — 策略基类

### 5.1 生命周期回调

```python
async def on_start(self) -> None:
    """Round 连接建立后调用一次，用于初始化策略状态。"""

async def on_stop(self) -> None:
    """Round 结束后调用一次，用于打印最终结果、清理状态。"""
```

---

### 5.2 市场事件回调

```python
async def on_orderbook(self, ticker: str, book: OrderBook) -> None:
    """
    每次订单簿更新时调用（约每 0.5 秒，每个品种独立触发）。
    这是策略最主要的驱动事件。

    参数：
        ticker: 品种代码，如 "PRODA"
        book:   最新订单簿快照
    """

async def on_trade(self, trade: Trade) -> None:
    """
    每笔成交发生后调用（包括机器人之间的成交）。

    参数：
        trade: 成交记录（ticker, price, quantity, aggressor_side）
    """

async def on_position_update(self, positions: list[Position]) -> None:
    """
    你的持仓发生变化后调用（每笔成交后、ETF 操作后、下单扣费后）。

    参数：
        positions: 你所有品种的最新仓位列表
    """

async def on_round_state(self, state: RoundState) -> None:
    """
    Round 状态变化时调用（ACTIVE / FINISHED）。
    Round 结束时策略会自动退出，一般不需要手动监听。
    """
```

---

### 5.3 便捷交易方法

这些方法封装了 `client.place_order`，直接在策略中调用：

```python
# 买入限价单
order = await self.buy_limit(ticker="PRODA", price=99.95, quantity=5)

# 卖出限价单
order = await self.sell_limit(ticker="PRODA", price=100.05, quantity=5)

# 买入市价单
order = await self.buy_market(ticker="PRODA", quantity=5)

# 卖出市价单
order = await self.sell_market(ticker="PRODA", quantity=5)

# IOC 下单（需通过 client.place_order 指定 order_type）
order = await self.client.place_order("PRODA", "BUY", "IOC", price=99.95, quantity=5)
```

---

### 5.4 便捷查询方法

```python
# 获取某品种的持仓（返回 Position 或 None）
pos = self.get_position("PRODA")
if pos:
    print(f"持仓数量: {pos.quantity}, 浮盈: {pos.unrealized_pnl:+.2f}")

# 获取所有品种的总 PnL
total = self.total_pnl()
print(f"总收益: {total:+.2f}")
```

---

## 6. 数据类型

### 6.1 OrderBook

订单簿快照，每 ~0.5 秒更新一次。

```python
@dataclass
class OrderBook:
    ticker: str
    bids: list[PriceLevel]    # 买单，最优（最高价）在前
    asks: list[PriceLevel]    # 卖单，最优（最低价）在前
    last_price: float | None  # 最新成交价
    fair_value: float | None  # 模拟器公允价值（机器人参考价）
    timestamp: datetime | None

    # 计算属性
    best_bid: float | None    # 最优买价（bids[0].price）
    best_ask: float | None    # 最优卖价（asks[0].price）
    mid: float | None         # 中间价 = (best_bid + best_ask) / 2
    spread: float | None      # 价差 = best_ask - best_bid
```

```python
@dataclass
class PriceLevel:
    price: float     # 价格
    quantity: int    # 该价格上的挂单总量
```

**使用示例：**

```python
async def on_orderbook(self, ticker, book):
    print(f"最优买价: {book.best_bid}")
    print(f"最优卖价: {book.best_ask}")
    print(f"中间价:   {book.mid}")
    print(f"价差:     {book.spread}")
    print(f"公允价值: {book.fair_value}")

    # 查看买盘前 3 档
    for level in book.bids[:3]:
        print(f"  BID {level.price:.2f} × {level.quantity}")
```

---

### 6.2 Order

```python
@dataclass
class Order:
    id: int                  # 订单 ID（用于撤单）
    ticker: str              # 品种代码
    side: str                # "BUY" | "SELL"
    order_type: str          # "LIMIT" | "MARKET" | "IOC"
    price: float | None      # 委托价格（MARKET 为 None）
    quantity: int            # 委托数量
    filled_quantity: int     # 已成交数量
    status: str              # "OPEN" | "PARTIAL" | "FILLED" | "CANCELLED"
    created_at: datetime
```

**订单状态含义：**

| 状态 | 含义 |
|---|---|
| `OPEN` | 未成交，在订单簿等待 |
| `PARTIAL` | 部分成交，剩余部分在订单簿（IOC 的 PARTIAL 表示剩余已取消） |
| `FILLED` | 全部成交 |
| `CANCELLED` | 已撤销 / IOC 未成交部分 |

---

### 6.3 Position

```python
@dataclass
class Position:
    ticker: str
    quantity: int        # 持仓数量（正=多头，负=空头，0=无仓位）
    avg_cost: float      # 加权平均成本
    realized_pnl: float  # 已实现收益（含手续费扣除）
    unrealized_pnl: float # 浮动收益（以结算价或最新成交价计算）
    total_pnl: float     # = realized_pnl + unrealized_pnl
```

**浮盈计算规则：**
- 若该品种配置了固定结算价（`settlement_price`）→ 以结算价计算
- 否则 → 以当前最新成交价计算

---

### 6.4 Trade

```python
@dataclass
class Trade:
    ticker: str
    price: float
    quantity: int
    aggressor_side: str  # "BUY"（主动买）| "SELL"（主动卖）
    executed_at: datetime
```

注意：`on_trade` 回调对所有成交触发，包括机器人之间的成交，不只是你自己的成交。

---

### 6.5 RoundState

```python
@dataclass
class RoundState:
    round_id: int
    status: str             # "ACTIVE" | "FINISHED"
    duration_seconds: int | None
    tickers: list[str]      # 本 Round 的品种列表
```

---

## 7. WebSocket 事件

当你通过 `client.connect()` 连接后，服务器会实时推送以下事件：

| 事件 | 触发时机 | 对应回调 |
|---|---|---|
| `orderbook_update` | 每 ~0.5 秒，每个品种 | `on_orderbook` |
| `trade` | 每笔成交发生后 | `on_trade` |
| `position_update` | 你的仓位变化后（含费用扣除） | `on_position_update` |
| `round_state` | Round 开始 / 结束时 | `on_round_state` |

连接建立的瞬间，服务器还会主动推送：
- 所有品种的当前订单簿（触发所有品种的 `on_orderbook`）
- 你的当前仓位（触发一次 `on_position_update`）

---

## 8. ETF 申购赎回

当 Round 中存在 ETF 品种时，你可以通过 REST API 进行申购和赎回。SDK 暂无封装方法，直接调用 `client._http`：

```python
import httpx

async def etf_create(client: SimuQuantClient, etf_ticker: str, lots: int):
    """申购：交出篮子成分，获得 ETF"""
    resp = await client._http.post(
        f"/rounds/{client._round_id}/etf/{etf_ticker}/operate",
        json={"action": "CREATE", "lots": lots},
    )
    resp.raise_for_status()
    return resp.json()

async def etf_redeem(client: SimuQuantClient, etf_ticker: str, lots: int):
    """赎回：交出 ETF，获得篮子成分"""
    resp = await client._http.post(
        f"/rounds/{client._round_id}/etf/{etf_ticker}/operate",
        json={"action": "REDEEM", "lots": lots},
    )
    resp.raise_for_status()
    return resp.json()

async def get_etf_nav(client: SimuQuantClient, etf_ticker: str):
    """查询 ETF 公允价值 vs 市场价，判断是否有套利机会"""
    resp = await client._http.get(
        f"/rounds/{client._round_id}/etf/{etf_ticker}/nav"
    )
    resp.raise_for_status()
    return resp.json()
    # 返回:
    # {
    #   "basket_nav": 470.0,        # 篮子成分的总价值（1 lot）
    #   "etf_market_value": 485.0,  # ETF 的市场价（lot_size 份）
    #   "arb_spread": 15.0,         # 价差（>0 = 申购套利机会）
    #   "create_profitable": True,  # 申购是否有利可图（arb_spread > fee）
    #   "redeem_profitable": False
    # }
```

---

## 9. 完整策略示例

### 9.1 示例 1：简单做市策略（带库存管理）

```python
"""
策略逻辑：
  - 在中间价 ± HALF_SPREAD 挂双边报价
  - 持仓过多时，偏移报价以减少同向累积（inventory skew）
  - 持仓超过 MAX_POSITION 时停止报价，等待回归
"""
from simquant import SimuQuantClient, BaseStrategy, OrderBook

HOST = "localhost:8000"
API_KEY = "your-api-key"
ROUND_ID = 1

HALF_SPREAD = 0.05
ORDER_SIZE = 5
MAX_POSITION = 30


class MarketMaker(BaseStrategy):
    def __init__(self):
        self._active_bids: dict[str, int] = {}   # ticker → order_id
        self._active_asks: dict[str, int] = {}

    async def on_start(self):
        print("做市商策略启动")

    async def on_orderbook(self, ticker: str, book: OrderBook):
        mid = book.mid
        if mid is None:
            return

        pos = self.get_position(ticker)
        qty = pos.quantity if pos else 0

        # 偏移：多头时提高卖价优先级，降低买价报价积极性
        skew = -qty * 0.003

        bid = round(mid - HALF_SPREAD + skew, 2)
        ask = round(mid + HALF_SPREAD + skew, 2)

        # 撤销旧报价
        for store in (self._active_bids, self._active_asks):
            if ticker in store:
                try:
                    await self.client.cancel_order(store.pop(ticker))
                except Exception:
                    pass

        # 库存过大时停止报价
        if abs(qty) >= MAX_POSITION:
            print(f"[{ticker}] 库存过大 ({qty})，暂停报价")
            return

        # 挂新报价
        try:
            o = await self.buy_limit(ticker, bid, ORDER_SIZE)
            self._active_bids[ticker] = o.id
        except Exception as e:
            print(f"挂买单失败: {e}")

        try:
            o = await self.sell_limit(ticker, ask, ORDER_SIZE)
            self._active_asks[ticker] = o.id
        except Exception as e:
            print(f"挂卖单失败: {e}")

    async def on_position_update(self, positions):
        summary = " | ".join(
            f"{p.ticker}: {p.quantity:+d} pnl={p.total_pnl:+.2f}"
            for p in positions
        )
        print(f"[仓位] 总PnL={self.total_pnl():+.2f} | {summary}")

    async def on_stop(self):
        print(f"Round 结束 | 最终 PnL: {self.total_pnl():+.2f}")


if __name__ == "__main__":
    client = SimuQuantClient(host=HOST, api_key=API_KEY)
    client.run(MarketMaker(), session_id=1, round_id=ROUND_ID)
```

---

### 9.2 示例 2：公允价值套利

```python
"""
策略逻辑：
  - 服务器每次推送订单簿时包含 fair_value（模拟器的公允价值）
  - 当市场中间价偏离公允价值超过阈值时，反向交易
  - 适合 MARKET 订单（快速成交，不等待）
"""
from simquant import SimuQuantClient, BaseStrategy, OrderBook

THRESHOLD = 0.08
ORDER_SIZE = 3


class FairValueArb(BaseStrategy):

    async def on_orderbook(self, ticker: str, book: OrderBook):
        if book.fair_value is None or book.mid is None:
            return

        deviation = book.mid - book.fair_value  # 正值：市场贵于公允

        if deviation > THRESHOLD:
            # 市场偏贵，卖出
            try:
                await self.sell_market(ticker, ORDER_SIZE)
                print(f"SELL {ticker} | mid={book.mid:.2f} fv={book.fair_value:.2f} 偏差={deviation:+.3f}")
            except Exception as e:
                print(f"卖单失败: {e}")

        elif deviation < -THRESHOLD:
            # 市场偏便宜，买入
            try:
                await self.buy_market(ticker, ORDER_SIZE)
                print(f"BUY  {ticker} | mid={book.mid:.2f} fv={book.fair_value:.2f} 偏差={deviation:+.3f}")
            except Exception as e:
                print(f"买单失败: {e}")

    async def on_position_update(self, positions):
        print(f"总PnL: {self.total_pnl():+.2f}")

    async def on_stop(self):
        print(f"最终PnL: {self.total_pnl():+.2f}")


if __name__ == "__main__":
    client = SimuQuantClient(host="localhost:8000", api_key="your-key")
    client.run(FairValueArb(), session_id=1, round_id=1)
```

---

### 9.3 示例 3：双品种价差套利（Round 3 场景）

```python
"""
Round 3 场景：PRODC 的公允价值保证约等于 2 × PRODB
策略：当 C_mid ≠ 2 × B_mid 时，套利

  C 偏高：卖 C + 买 B（预期 C 回落 / B 上涨）
  C 偏低：买 C + 卖 B（预期 C 上涨 / B 回落）

注意：需要同时对两个品种进行 IOC 订单，确保快速成交
"""
from simquant import SimuQuantClient, BaseStrategy, OrderBook

TICKER_A = "PRODB"   # 基础品种
TICKER_B = "PRODC"   # 相关性品种，公允价值 = 2 × PRODB
MULTIPLIER = 2.0
THRESHOLD = 0.5      # 价差偏离超过 0.5 才交易
ORDER_SIZE = 3


class PairArb(BaseStrategy):
    def __init__(self):
        self._books: dict[str, OrderBook] = {}
        self._in_trade = False

    async def on_orderbook(self, ticker: str, book: OrderBook):
        self._books[ticker] = book

        if TICKER_A not in self._books or TICKER_B not in self._books:
            return
        if self._in_trade:
            return

        mid_a = self._books[TICKER_A].mid
        mid_b = self._books[TICKER_B].mid
        if mid_a is None or mid_b is None:
            return

        theoretical_b = MULTIPLIER * mid_a
        spread = mid_b - theoretical_b  # C 相对于 2B 的偏差

        if spread > THRESHOLD:
            # C 偏贵：IOC 卖 C，同时 IOC 买 B
            self._in_trade = True
            try:
                await self.client.place_order(
                    TICKER_B, "SELL", "IOC",
                    price=mid_b - 0.05,   # 略低于中间价，提高成交概率
                    quantity=ORDER_SIZE
                )
                await self.client.place_order(
                    TICKER_A, "BUY", "IOC",
                    price=mid_a + 0.05,
                    quantity=ORDER_SIZE * int(MULTIPLIER)
                )
                print(f"套利: SELL {TICKER_B}@{mid_b:.2f}, BUY {TICKER_A}@{mid_a:.2f} | spread={spread:+.3f}")
            except Exception as e:
                print(f"套利失败: {e}")
            finally:
                self._in_trade = False

        elif spread < -THRESHOLD:
            # C 偏便宜：IOC 买 C，同时 IOC 卖 B
            self._in_trade = True
            try:
                await self.client.place_order(
                    TICKER_B, "BUY", "IOC",
                    price=mid_b + 0.05,
                    quantity=ORDER_SIZE
                )
                await self.client.place_order(
                    TICKER_A, "SELL", "IOC",
                    price=mid_a - 0.05,
                    quantity=ORDER_SIZE * int(MULTIPLIER)
                )
                print(f"套利: BUY {TICKER_B}@{mid_b:.2f}, SELL {TICKER_A}@{mid_a:.2f} | spread={spread:+.3f}")
            except Exception as e:
                print(f"套利失败: {e}")
            finally:
                self._in_trade = False

    async def on_position_update(self, positions):
        pos_str = " | ".join(f"{p.ticker}:{p.quantity:+d}" for p in positions)
        print(f"PnL={self.total_pnl():+.2f} | {pos_str}")

    async def on_stop(self):
        print(f"最终PnL: {self.total_pnl():+.2f}")


if __name__ == "__main__":
    client = SimuQuantClient(host="localhost:8000", api_key="your-key")
    client.run(PairArb(), session_id=1, round_id=3)
```

---

### 9.4 示例 4：ETF 篮子套利（Round 4 场景）

```python
"""
Round 4 场景：10E ⟺ 2A + 3C + 4D，申购赎回手续费 $10

套利逻辑：
  ETF 市场价 × 10 > 篮子成本 + 10 → 申购套利
    1. 市价买入 2A + 3C + 4D
    2. 申购 → 获得 10E
    3. 卖出 10E

  ETF 市场价 × 10 < 篮子价值 - 10 → 赎回套利
    1. 市价买入 10E
    2. 赎回 → 获得 2A + 3C + 4D
    3. 分别卖出 A/C/D
"""
import asyncio
from simquant import SimuQuantClient, BaseStrategy, OrderBook

ETF_TICKER = "PRODE"
BASKET = {"PRODA": 2, "PRODC": 3, "PRODD": 4}
LOT_SIZE = 10
ETF_FEE = 10.0
ARB_MIN_PROFIT = 2.0   # 套利价差需超过手续费才操作（留安全边际）


async def etf_operate(client, action: str, lots: int):
    resp = await client._http.post(
        f"/rounds/{client._round_id}/etf/{ETF_TICKER}/operate",
        json={"action": action, "lots": lots},
    )
    resp.raise_for_status()
    return resp.json()


async def get_nav(client):
    resp = await client._http.get(
        f"/rounds/{client._round_id}/etf/{ETF_TICKER}/nav"
    )
    resp.raise_for_status()
    return resp.json()


class ETFArbStrategy(BaseStrategy):
    def __init__(self):
        self._books: dict[str, OrderBook] = {}
        self._busy = False

    async def on_orderbook(self, ticker: str, book: OrderBook):
        self._books[ticker] = book

        required = set(BASKET.keys()) | {ETF_TICKER}
        if not required.issubset(self._books.keys()):
            return
        if self._busy:
            return

        # 计算篮子价值
        basket_cost = sum(
            self._books[t].best_ask or 0 * ratio  # 买入成本用 ask
            for t, ratio in BASKET.items()
        )
        etf_bid = self._books[ETF_TICKER].best_bid or 0
        etf_ask = self._books[ETF_TICKER].best_ask or 0

        create_profit = etf_bid * LOT_SIZE - basket_cost - ETF_FEE
        redeem_basket = sum(
            (self._books[t].best_bid or 0) * ratio
            for t, ratio in BASKET.items()
        )
        redeem_profit = redeem_basket - etf_ask * LOT_SIZE - ETF_FEE

        if create_profit > ARB_MIN_PROFIT:
            await self._do_create(create_profit)
        elif redeem_profit > ARB_MIN_PROFIT:
            await self._do_redeem(redeem_profit)

    async def _do_create(self, expected_profit: float):
        """申购套利：买入成分 → 申购 → 卖出 ETF"""
        self._busy = True
        print(f"[申购套利] 预期收益: {expected_profit:.2f}")
        try:
            # 1. 买入所有篮子成分（MARKET 单确保成交）
            for ticker, ratio in BASKET.items():
                await self.buy_market(ticker, ratio)

            # 2. 申购 ETF
            result = await etf_operate(self.client, "CREATE", lots=1)
            print(f"  申购成功: {result['etf_quantity_delta']:+d} {ETF_TICKER}")

            # 3. 卖出 ETF
            await self.sell_market(ETF_TICKER, LOT_SIZE)
            print(f"  卖出 {LOT_SIZE} {ETF_TICKER} 完成")
        except Exception as e:
            print(f"  申购套利失败: {e}")
        finally:
            self._busy = False

    async def _do_redeem(self, expected_profit: float):
        """赎回套利：买入 ETF → 赎回 → 卖出成分"""
        self._busy = True
        print(f"[赎回套利] 预期收益: {expected_profit:.2f}")
        try:
            # 1. 买入 ETF
            await self.buy_market(ETF_TICKER, LOT_SIZE)

            # 2. 赎回
            result = await etf_operate(self.client, "REDEEM", lots=1)
            print(f"  赎回成功: {result['basket_deltas']}")

            # 3. 卖出所有成分
            for ticker, ratio in BASKET.items():
                await self.sell_market(ticker, ratio)
            print(f"  卖出成分完成")
        except Exception as e:
            print(f"  赎回套利失败: {e}")
        finally:
            self._busy = False

    async def on_position_update(self, positions):
        pos_str = " | ".join(
            f"{p.ticker}:{p.quantity:+d}(pnl={p.total_pnl:+.1f})"
            for p in positions if p.quantity != 0
        )
        print(f"PnL={self.total_pnl():+.2f} | {pos_str}")

    async def on_stop(self):
        print(f"最终PnL: {self.total_pnl():+.2f}")


if __name__ == "__main__":
    client = SimuQuantClient(host="localhost:8000", api_key="your-key")
    client.run(ETFArbStrategy(), session_id=1, round_id=4)
```

---

## 10. 常见错误与处理

| HTTP 状态码 | 原因 | 处理建议 |
|---|---|---|
| `400 Bad Request` | 参数错误 / 违反交易规则 | 打印 `e.message` 查看原因 |
| `400 Order type X is not allowed` | 该品种不允许该订单类型 | 检查 Round 规则，改用允许的类型 |
| `400 Order quantity N exceeds max` | 单笔数量超限 | 拆分为多笔小单 |
| `400 Insufficient TICKER` | ETF 申赎时持仓不足 | 检查仓位后重试 |
| `401 Unauthorized` | API Key 无效 | 联系管理员确认 Key |
| `429 Rate limit exceeded` | 超过每秒下单速率 | 降低下单频率，加 sleep |
| `503 Service Unavailable` | Round 运行时不可用（未启动）| 确认 Round 已 ACTIVE |

**标准错误处理模式：**

```python
async def on_orderbook(self, ticker, book):
    try:
        order = await self.buy_limit(ticker, book.best_bid - 0.01, 5)
    except Exception as e:
        # SDK 将 HTTP 错误转换为 httpx.HTTPStatusError
        # e.response.text 包含后端的详细错误信息
        print(f"下单失败: {e}")
        return
```

**处理速率限制（Round 3 B 品种限 20 笔/秒）：**

```python
import asyncio

async def on_orderbook(self, ticker, book):
    try:
        await self.client.place_order(ticker, "BUY", "IOC", price=..., quantity=5)
    except Exception as e:
        if "Rate limit" in str(e):
            await asyncio.sleep(0.1)  # 等待 100ms 后重试
        else:
            raise
```

---

## 11. 策略编写最佳实践

### 不要在 `on_orderbook` 中挂太多未取消的旧单

每次 `on_orderbook` 时，若直接下新单而不撤旧单，订单簿会积累大量过时挂单：

```python
# ❌ 错误：每次都挂新单，不撤旧单
async def on_orderbook(self, ticker, book):
    await self.buy_limit(ticker, book.mid - 0.05, 5)   # 旧单永远不撤

# ✅ 正确：先撤旧单，再挂新单
async def on_orderbook(self, ticker, book):
    if ticker in self._bid_orders:
        await self.client.cancel_order(self._bid_orders.pop(ticker))
    order = await self.buy_limit(ticker, book.mid - 0.05, 5)
    self._bid_orders[ticker] = order.id
```

---

### 避免重入：用标志位防止同一时刻多次触发

```python
async def on_orderbook(self, ticker, book):
    if self._processing:
        return
    self._processing = True
    try:
        # ... 执行交易逻辑
    finally:
        self._processing = False
```

---

### 使用 `on_position_update` 监控状态，不要在 `on_orderbook` 中调用 REST 查仓位

`on_position_update` 由 WebSocket 实时推送，不消耗速率限制：

```python
# ❌ 慢且占用请求配额
async def on_orderbook(self, ticker, book):
    positions = await self.client.get_positions()   # HTTP 请求

# ✅ 从 WS 推送的本地状态读取（零延迟）
async def on_orderbook(self, ticker, book):
    pos = self.get_position(ticker)   # 读取本地缓存
```

---

### IOC 策略：接受部分成交

IOC 订单不保证全量成交，务必检查实际成交量：

```python
order = await self.client.place_order("PRODB", "BUY", "IOC", price=100, quantity=5)
print(f"委托 5，实际成交 {order.filled_quantity}，状态 {order.status}")
# status 可能是 "PARTIAL" 或 "CANCELLED"（零成交）
```

---

### 合理设置 `THRESHOLD` 和保护边际

ETF 套利必须考虑**滑点 + 手续费**才能真正盈利：

```python
# 申购套利需要：
# ETF卖出价 × 10 - 篮子买入成本 - ETF手续费 > 0
# 实际还需减去：market order 的 bid-ask 滑点 × 所有品种

MIN_PROFIT = ETF_FEE + EXPECTED_SLIPPAGE   # e.g. 10 + 3 = 13
if create_profit > MIN_PROFIT:
    await self._do_create()
```
