# SimuQuant — 项目架构文档

> 最后更新：2026-03-19

---

## 目录

1. [整体架构](#1-整体架构)
2. [六大主体](#2-六大主体)
   - [2.1 撮合引擎 Matching Engine](#21-撮合引擎-matching-engine)
   - [2.2 价格模拟器 Price Simulator](#22-价格模拟器-price-simulator)
   - [2.3 机器人系统 Bot System](#23-机器人系统-bot-system)
   - [2.4 轮次运行时 Round Runtime](#24-轮次运行时-round-runtime)
   - [2.5 实时通信层 WebSocket Manager](#25-实时通信层-websocket-manager)
   - [2.6 前端 Frontend](#26-前端-frontend)
3. [数据库结构](#3-数据库结构)
4. [完整下单流程](#4-完整下单流程)
5. [ETF 申购赎回流程](#5-etf-申购赎回流程)
6. [Round 生命周期](#6-round-生命周期)
7. [文件目录](#7-文件目录)

---

## 1. 整体架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                          用户界面层                                   │
│   Browser / SDK Client                                              │
│   - 浏览器前端 (React + Zustand)                                      │
│   - Python SDK (SimuQuantClient + BaseStrategy)                     │
└───────────────┬─────────────────────────────┬───────────────────────┘
                │  REST API (HTTP)             │  实时推送 (WebSocket)
                ▼                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       FastAPI 后端                                   │
│                                                                     │
│  ┌────────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐  │
│  │  API 路由层 │  │  认证层   │  │  WS 层   │  │    后台任务       │  │
│  │ sessions   │  │ api-key  │  │ ws_mgr   │  │  BotManager      │  │
│  │ orders     │  │ auth.py  │  │ /ws/...  │  │  auto_finish     │  │
│  │ market     │  └──────────┘  └──────────┘  └──────────────────┘  │
│  │ etf        │                                                     │
│  └────────────┘                                                     │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                    核心业务层 (Core)                           │   │
│  │  ┌──────────────┐  ┌────────────┐  ┌───────────────────────┐ │   │
│  │  │  撮合引擎     │  │  价格模拟器  │  │   轮次运行时           │ │   │
│  │  │ LimitOrder   │  │ MarketSim  │  │   RoundRuntime        │ │   │
│  │  │ Book         │  │ (GBM+Jump) │  │  - 仓位管理            │ │   │
│  │  └──────────────┘  └────────────┘  │  - 限速               │ │   │
│  │  ┌──────────────┐                  │  - ETF 申赎            │ │   │
│  │  │  机器人系统   │                  └───────────────────────┘ │   │
│  │  │  BotManager  │                                            │   │
│  │  │  MM + Noise  │                                            │   │
│  │  └──────────────┘                                            │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────┬───────────────────────────────┘
                                      │ SQLAlchemy (async)
                                      ▼
                             ┌─────────────────┐
                             │    SQLite DB     │
                             │  users / rounds  │
                             │  orders / trades │
                             │  positions       │
                             └─────────────────┘
```

**技术栈：**

| 层级 | 技术 |
|---|---|
| 后端框架 | FastAPI + uvicorn (async) |
| 数据库 ORM | SQLAlchemy async + aiosqlite (SQLite) |
| 前端框架 | React 18 + TypeScript + Vite |
| 状态管理 | Zustand |
| 图表 | Recharts |
| 实时通信 | WebSocket (原生) |
| SDK 客户端 | httpx + websockets |
| 部署 | Docker + docker-compose |

---

## 2. 六大主体

### 2.1 撮合引擎 Matching Engine

**文件：** `backend/app/core/engine.py`

撮合引擎是整个系统的心脏。每个交易品种（Ticker）有且仅有一个 `LimitOrderBook` 实例，负责维护该品种的全部挂单，并在新订单到达时即时撮合。

#### 内部数据结构

```
_bids: SortedDict { key = -price → deque[BookOrder] }
       (负数 key 使遍历时最大价格排首位，即最优买价)

_asks: SortedDict { key = +price → deque[BookOrder] }
       (正数 key 使遍历时最小价格排首位，即最优卖价)

每个价格层级内部是 deque：先进先出（FIFO），保证同价优先成交更早的订单。
```

#### 订单类型处理

| 订单类型 | 行为 |
|---|---|
| `LIMIT` | 先按价格尝试撮合对手方，未成交部分挂入订单簿等待 |
| `MARKET` | 无视价格，吃光对手方直到成交完毕；若无对手方则 CANCELLED |
| `IOC` (Immediate-or-Cancel) | 同 LIMIT 尝试撮合，未成交部分立即丢弃（不进入订单簿） |

#### 撮合规则（Price-Time Priority）

1. **价格优先**：买方出价越高越优先；卖方要价越低越优先
2. **时间优先**：同价格内，先挂单者先成交（FIFO）
3. **成交价**：以**被动方（Maker）的挂单价格**成交，即主动方吃单时以对方报价成交

#### 并发安全

每个 `LimitOrderBook` 持有一把 `asyncio.Lock`，所有写操作（撮合、挂单、撤单）均在锁保护下串行执行，确保在 Python async 环境下不产生竞态条件。

---

### 2.2 价格模拟器 Price Simulator

**文件：** `backend/app/core/sim.py`

模拟器负责在每个 tick（约 0.5 秒）给每个品种生成一个新的**公允价值（Fair Value）**，供做市商机器人报价参考。公允价值本身不直接参与撮合，它影响的是机器人的报价行为，从而间接影响市场价格。

#### 独立品种：GBM + Jump Diffusion

$$
S_{t+1} = S_t \cdot \exp\!\Bigl((\mu - \tfrac{\sigma^2}{2})\Delta t + \sigma\sqrt{\Delta t}\,Z\Bigr) \cdot \exp(J)
$$

- $\mu$：漂移率（drift）
- $\sigma$：波动率（volatility）
- $Z \sim \mathcal{N}(0,1)$：随机冲击
- $J$：以泊松概率 $\lambda \Delta t$ 触发的跳跃（Jump），大小为 $\pm$ `jump_size`

#### 相关性品种（Round 3 / Round 4 场景）

当品种 C 配置了 `price_ref_ticker = "B"` 和 `price_multiplier = 2.0` 时：

$$
\ln S_C^{(t+1)} = \ln S_C^{(t)} + 0.3 \cdot \ln\!\frac{2 \cdot S_B^{(t)}}{S_C^{(t)}} + \sigma_{\text{residual}} \cdot Z
$$

- **均值回归**：以 0.3 的强度将 C 的公允价值拉向 $2 \times B$
- **残差噪声**：小量独立噪声，制造 C 偏离 $2B$ 的套利机会

每个 tick，模拟器先更新所有独立品种，再更新所有相关性品种（保证引用的基础品种已经更新）。

---

### 2.3 机器人系统 Bot System

**文件：** `backend/app/core/bots.py`

机器人是系统流动性的主要来源。没有机器人，单个用户无法交易（没有对手方）。所有机器人订单绕过 HTTP API，直接调用 `LimitOrderBook`，不受用户的速率限制和手续费约束。

#### 做市商机器人 MarketMakerBot

每 `~0.5s` 执行一次报价刷新：

```
1. 撤销上一轮自己的 BID 和 ASK 挂单
2. 读取模拟器的最新公允价值 fv
3. 在订单簿挂入新的双边报价：
   BID = fv - spread/2 + random(-0.01, 0.01)
   ASK = fv + spread/2 + random(-0.01, 0.01)
```

配置了 `mm_bot_count = 3` 时，同时运行 3 个做市商机器人，它们的随机噪声相互不同步，使订单簿呈现多层次的报价深度。

#### 噪声交易者 NoiseTraderBot

每 `~1.5s` 执行一次随机市价单（BUY 或 SELL，数量 1–5），消耗做市商挂单，产生真实成交和价格波动。

#### 价格推送循环 `_price_tick_loop`

每 0.5s：
1. 调用 `sim.tick_all()` 更新所有品种的公允价值
2. 将新公允价值记录入 `RoundRuntime.price_history`
3. 广播 `orderbook_update` WebSocket 事件（含 `fair_value` 字段）给所有已连接的客户端

---

### 2.4 轮次运行时 Round Runtime

**文件：** `backend/app/core/session.py`

`RoundRuntime` 是一个活跃轮次的**内存状态容器**，生命周期与 Round 的 ACTIVE 状态完全一致：Round 开始时创建，Round 结束时销毁。数据库只保存持久化记录；所有实时计算均在这里发生。

#### 内部状态

```python
books: dict[ticker → LimitOrderBook]         # 每个品种的订单簿
positions: dict[user_id → dict[ticker → {
    qty: int,           # 持仓数量（可为负，即做空）
    avg_cost: float,    # 加权平均成本
    realized: float,    # 已实现 PnL
    fees_paid: float,   # 累计手续费
}]]
price_history: dict[ticker → [(datetime, price), ...]]  # 最近 500 个价格点
settlement_prices: dict[ticker → float]       # 固定结算价（若配置）
ticker_rules: dict[ticker → {                 # Per-ticker 规则覆盖
    allowed_order_types: list,
    max_orders_per_second: int,
    max_order_quantity: int,
}]
_order_timestamps: dict[(user_id, ticker) → [float, ...]]  # 限速滑动窗口
```

#### 关键方法

| 方法 | 作用 |
|---|---|
| `apply_order_fee(user_id, ticker, fee)` | 下单瞬间扣除手续费（计入 realized PnL） |
| `apply_trade_to_position(...)` | 成交后更新持仓数量和加权平均成本 |
| `get_unrealized_pnl(user_id, ticker, last_price)` | 以结算价（若有）或最新成交价计算浮盈 |
| `check_rate_limit(user_id, ticker)` | 1 秒滑动窗口限速，per-ticker 独立计算 |
| `check_order_type_allowed(ticker, order_type)` | 检查订单类型白名单（per-ticker） |
| `etf_operate(user_id, etf_ticker, cfg, action, lots)` | ETF 申购/赎回，原子性多品种仓位变更 |
| `get_position_snapshot(user_id)` | 返回含浮盈的完整仓位快照 |

#### 仓位更新逻辑（`apply_trade_to_position`）

**买入时**（加仓）：
```
avg_cost = (avg_cost × qty + price × new_qty) / (qty + new_qty)
qty += new_qty
```

**卖出时**（减仓或做空）：
```
realized += (price - avg_cost) × sell_qty
qty -= sell_qty
# 若 qty 降为 0，清零 avg_cost
# 若 qty 变负（做空），新 avg_cost = sell_price
```

---

### 2.5 实时通信层 WebSocket Manager

**文件：** `backend/app/core/ws_manager.py`

`ConnectionManager` 维护所有 WebSocket 连接，支持两种推送模式：

| 模式 | 方法 | 适用场景 |
|---|---|---|
| 广播 | `broadcast(round_id, event, data)` | 发给该 round 的所有订阅者（行情、成交） |
| 定向推送 | `send_to_user(round_id, user_id, event, data)` | 只发给特定用户（仓位更新） |

**连接管理：**
- `_channels: dict[round_id → list[(WebSocket, user_id?)]]`
- 客户端断线时自动从 channel 移除；发送失败时也自动清理僵尸连接

**客户端连接时的初始推送（on connect）：**
1. 对每个 ticker 推送一次 `orderbook_update`（当前快照）
2. 对已认证的用户推送一次 `position_update`（当前仓位）

**WebSocket 事件一览：**

```
服务端 → 所有订阅者：
  orderbook_update  每 ~0.5s，含 bids/asks/last_price/fair_value
  trade             每次成交后
  round_state       Round 开始 / 结束时

服务端 → 特定用户：
  position_update   每次成交后 / ETF 操作后 / 下单后（含 fee 扣除）

客户端 → 服务端：
  {"action": "ping"}   心跳检测，服务端回 {"type": "pong"}
```

---

### 2.6 前端 Frontend

**文件：** `frontend/src/`

前端是 React 单页应用，分三层：

#### 全局状态（Zustand Stores）

```
authStore       用户身份（api_key 持久化到 localStorage，user 对象）
marketStore     行情状态（WS 连接、orderBooks、positions、recentTrades、priceHistory）
```

#### 页面路由

| 路径 | 页面 | 权限 |
|---|---|---|
| `/login` | 输入 API Key 登录 | 无 |
| `/` | Session 列表，选择轮次进入交易 | 已登录 |
| `/trade/:roundId` | 交易主界面 | 已登录 |
| `/admin` | 管理员面板（创建 Session/Round/User） | 管理员 |

#### 交易页面布局（`TradePage`）

```
┌────────────┬──────────────┬──────────────┬────────────────┐
│            │  PriceChart  │  TradeBlotter │                │
│ OrderBook  │  价格走势图   │  最新成交记录  │  OrderEntry    │
│  买卖盘     ├──────────────┼──────────────┤  下单面板       │
│            │  Positions   │  MyOrders    │                │
│            │  我的仓位     │  我的订单     │  ETFPanel      │
│            │             │              │  ETF 申赎       │
└────────────┴──────────────┴──────────────┴────────────────┘
```

#### 核心组件职责

| 组件 | 数据来源 | 职责 |
|---|---|---|
| `OrderBook` | `marketStore.orderBooks` (WS) | 实时渲染买卖盘深度，带柱状宽度可视化 |
| `PriceChart` | `marketStore.priceHistory` (WS) | Recharts 面积图，含公允价值参考线 |
| `TradeBlotter` | `marketStore.recentTrades` (WS) | 最新 100 笔成交滚动显示 |
| `Positions` | `marketStore.positions` (WS) | 持仓、成本、浮盈/实盈、手续费汇总 |
| `OrderEntry` | `round` (REST) | 下单表单，客户端校验规则，支持 LIMIT/IOC/MARKET |
| `ETFPanel` | `api.etfNav()` (轮询) | 显示 NAV 套利价差，执行申购赎回 |
| `MyOrders` | `api.getOrders()` (REST) | 个人挂单列表，支持撤单 |
| `RoundTimer` | `marketStore.round` | 倒计时进度条 |
| `AdminPage` | REST API | 创建 Session/Round（含 ETF/相关性配置）/User |

---

## 3. 数据库结构

```
users
├── id (PK)
├── username (unique)
├── api_key (unique, 48-char hex)
├── is_admin
└── created_at

sessions
├── id (PK)
├── name
├── status  (PENDING → ACTIVE → FINISHED)
├── created_at
├── started_at
└── finished_at

rounds
├── id (PK)
├── session_id (FK → sessions)
├── round_number
├── name
├── status  (PENDING → ACTIVE → FINISHED)
├── duration_seconds
├── tickers_config  (JSON)  ← 包含所有 per-ticker 配置（GBM、规则、ETF 篮子）
├── mm_bot_count / noise_bot_count / mm_spread / mm_order_size
├── order_fee / max_order_quantity / max_orders_per_second
├── started_at
└── finished_at

orders
├── id (PK)
├── round_id (FK → rounds)
├── user_id (FK → users, NULL if bot)
├── bot_id  (非 NULL 表示是机器人订单)
├── ticker
├── side  (BUY | SELL)
├── order_type  (LIMIT | MARKET | IOC)
├── price  (NULL for MARKET)
├── quantity / filled_quantity
├── status  (OPEN → PARTIAL → FILLED | CANCELLED)
└── created_at / updated_at

trades
├── id (PK)
├── round_id (FK → rounds)
├── ticker
├── price / quantity
├── buyer_order_id / seller_order_id (FK → orders)
├── aggressor_side  (哪方是主动成交方)
└── executed_at

positions  ← 历史记录，实时数据以 RoundRuntime 内存为准
├── id (PK)
├── round_id / user_id / ticker
├── quantity / avg_cost / realized_pnl
```

**关键设计说明：**

- `tickers_config` 存为 JSON，包含每个品种的全部配置（GBM 参数、允许的订单类型、ETF 篮子定义等），避免为每个新特性修改数据库 Schema
- 机器人订单也写入 `orders` 表（`user_id = NULL`，`bot_id` 有值），便于审计
- `positions` 表作为备份，实时仓位状态以内存中的 `RoundRuntime.positions` 为权威

---

## 4. 完整下单流程

以**用户提交一笔 LIMIT BUY 订单**为例，描述从 HTTP 请求到仓位更新的完整过程：

```
用户/SDK
  │
  │  POST /api/rounds/{round_id}/orders
  │  Headers: X-Api-Key: xxx
  │  Body: { ticker:"AAPL", side:"BUY", order_type:"LIMIT", price:149.95, quantity:10 }
  │
  ▼
┌─────────────────────────────────────────────────────────────────┐
│  orders.py / place_order()                                      │
│                                                                 │
│  1. 认证：auth.py 查 DB 找到 User 对象                           │
│                                                                 │
│  2. 校验 Round 状态：                                            │
│     ✓ Round 存在且 status == ACTIVE                             │
│     ✓ ticker "AAPL" 在 round.tickers_config 中                 │
│                                                                 │
│  3. 基础参数校验：                                               │
│     ✓ LIMIT 必须有 price                                        │
│     ✓ quantity > 0                                              │
│                                                                 │
│  4. 交易规则校验（RoundRuntime）：                               │
│     ✓ check_order_type_allowed("AAPL", "LIMIT")                │
│       → 若 AAPL 配置了 allowed_order_types=["IOC"]，拒绝 → 400 │
│     ✓ get_max_order_quantity("AAPL")                           │
│       → 若 10 > max_qty，拒绝 → 400                            │
│     ✓ check_rate_limit(user.id, "AAPL")                       │
│       → 1秒内超过 max_orders_per_second，拒绝 → 429            │
│                                                                 │
│  5. 扣除手续费（若 order_fee > 0）：                             │
│     rt.apply_order_fee(user.id, "AAPL", order_fee)            │
│     → positions[user.id]["AAPL"]["realized"] -= fee           │
│     → positions[user.id]["AAPL"]["fees_paid"] += fee          │
│                                                                 │
│  6. 写入 DB：                                                   │
│     INSERT INTO orders (status="OPEN", filled_quantity=0, ...) │
│     → 获得 order.id = 42                                        │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  LimitOrderBook.process_order(BookOrder)                        │
│                                                                 │
│  Acquire asyncio.Lock                                           │
│                                                                 │
│  _match_limit(aggressor=BUY@149.95):                           │
│    遍历 _asks（从最低卖价开始）：                                  │
│      ask_key = 149.90 ≤ 149.95 → 可成交                        │
│        取出 ask 队列 deque 的第一个挂单（价格优先+时间优先）       │
│        成交量 = min(remaining_buy, passive_qty)                 │
│        exec_price = 149.90（被动方的挂单价）                     │
│        _make_trade() → TradeRecord                             │
│        passive 订单 qty 减少，若耗尽则从 deque 移除             │
│      ask_key = 150.05 > 149.95 → 停止遍历                      │
│                                                                 │
│  假设成交 7 手（仍剩 3 手未成交）：                                │
│    order.filled = 7, order.remaining = 3                       │
│    is_done = False → PARTIAL                                   │
│    LIMIT order → _add_to_book(order)                           │
│      将剩余 3 手挂入 _bids[−149.95] 队列末尾                     │
│                                                                 │
│  Release asyncio.Lock                                           │
│                                                                 │
│  asyncio.create_task(fire_callbacks([trade]))                  │
└───────────────────────────┬─────────────────────────────────────┘
                            │  （异步，不阻塞 API 响应）
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  TradeHandler.on_trade(trade)                                   │
│                                                                 │
│  ① 更新内存仓位                                                  │
│     rt.apply_trade_to_position(buyer_user.id, "AAPL",          │
│                                "BUY", 149.90, 7)               │
│       → qty: 0→7, avg_cost: 0→149.90, realized 不变            │
│                                                                 │
│     若卖方是真实用户（非机器人）：                                  │
│       rt.apply_trade_to_position(seller_user.id, "AAPL",       │
│                                  "SELL", 149.90, 7)            │
│                                                                 │
│  ② 写入 DB                                                      │
│     INSERT INTO trades (round_id, ticker, price=149.90,        │
│                         quantity=7, aggressor_side="BUY", ...) │
│                                                                 │
│  ③ 广播公开成交事件（所有订阅者）                                  │
│     ws_manager.broadcast(round_id, "trade", {                  │
│       ticker:"AAPL", price:149.90, quantity:7,                 │
│       aggressor_side:"BUY", executed_at:...                    │
│     })                                                          │
│     → 前端 TradeBlotter 实时更新                                 │
│                                                                 │
│  ④ 定向推送个人仓位（只发给相关用户）                               │
│     ws_manager.send_to_user(round_id, buyer.id,                │
│                             "position_update",                  │
│                             rt.get_position_snapshot(buyer.id)) │
│     → 前端 Positions 实时更新（含浮盈计算）                       │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  回到 orders.py（await book.process_order 完成后）               │
│                                                                 │
│  7. 更新 DB 中的订单状态：                                        │
│     order_db.filled_quantity = 7                               │
│     order_db.status = "PARTIAL"  （仍有 3 手在挂单簿）           │
│     COMMIT                                                      │
│                                                                 │
│  8. 再次推送仓位（含手续费已扣状态，确保及时性）：                   │
│     ws_manager.send_to_user(..., "position_update", snapshot)  │
│                                                                 │
│  9. 返回 HTTP 200 + OrderOut JSON                               │
│     { id:42, status:"PARTIAL", filled_quantity:7, ... }        │
└─────────────────────────────────────────────────────────────────┘

客户端收到响应，同时也通过 WebSocket 已收到：
  - "trade" 事件 → TradeBlotter 出现新成交记录
  - "position_update" 事件 → Positions 显示 AAPL: qty=7, avg_cost=149.90
```

**关键时序特点：**
- HTTP 响应（步骤 1–9）和 WS 推送（步骤 ①–④）**并发执行**，用户在 API 返回前就可能已通过 WS 收到仓位更新
- 撮合引擎通过回调（callback）与交易处理器解耦；添加新的 callback（如日志记录）不影响引擎本身

---

## 5. ETF 申购赎回流程

以**申购（CREATE）`1 lot` 的 E，其中 10E ⟺ 2A + 3C + 4D，手续费 $10**为例：

```
用户
  │
  │  POST /api/rounds/{r}/etf/E/operate
  │  Body: { action: "CREATE", lots: 1 }
  │
  ▼
┌─────────────────────────────────────────────────────────────────┐
│  etf.py / etf_operate()                                         │
│                                                                 │
│  1. 验证 ticker E 存在且 is_etf = True                          │
│  2. 验证篮子品种（A, C, D）都在当前 Round 中                      │
│                                                                 │
│  → rt.etf_operate(user.id, "E", etf_cfg, "CREATE", lots=1)     │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  RoundRuntime.etf_operate()                                     │
│                                                                 │
│  校验持仓是否充足：                                               │
│    need A = 2×1=2, have A = 5  ✓                               │
│    need C = 3×1=3, have C = 4  ✓                               │
│    need D = 4×1=4, have D = 6  ✓                               │
│                                                                 │
│  快照成本（在修改前）：                                            │
│    A.avg_cost = 100.0 → 贡献成本 = 100 × 2 = 200               │
│    C.avg_cost =  50.0 → 贡献成本 =  50 × 3 = 150               │
│    D.avg_cost =  30.0 → 贡献成本 =  30 × 4 = 120               │
│    total_basket_cost = 470                                      │
│                                                                 │
│  扣减成分品种（原子性）：                                          │
│    positions[A].qty: 5 → 3                                     │
│    positions[C].qty: 4 → 1                                     │
│    positions[D].qty: 6 → 2                                     │
│                                                                 │
│  增加 ETF 持仓：                                                 │
│    new_etf_units = 10 × 1 = 10                                 │
│    E 原有 qty=0 → E.qty = 10                                    │
│    E.avg_cost = (0 + 470) / 10 = 47.0                          │
│                                                                 │
│  扣除手续费：                                                    │
│    positions[E].realized -= 10.0                               │
│    positions[E].fees_paid += 10.0                              │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  推送 position_update（所有品种的更新仓位）                        │
│  返回 ETFOperateResult：                                         │
│  {                                                              │
│    action: "CREATE", lots: 1, etf_ticker: "E",                 │
│    etf_quantity_delta: +10,                                     │
│    basket_deltas: {A: -2, C: -3, D: -4},                      │
│    fee: 10.0                                                    │
│  }                                                              │
└─────────────────────────────────────────────────────────────────┘
```

**套利逻辑（对应 Round 4 题目）：**

`api.etfNav()` 每 2 秒由前端轮询，实时计算：

```
basket_NAV  = last_price_A × 2 + last_price_C × 3 + last_price_D × 4
etf_market  = (ETF_mid_price) × 10

arb_spread  = etf_market - basket_NAV

当 arb_spread > 10（手续费）：申购套利
  → 分别买入 A/C/D → 申购成 E → 卖出 E，锁定价差

当 arb_spread < -10：赎回套利
  → 买入 E → 赎回拆成 A/C/D → 分别卖出，锁定价差
```

---

## 6. Round 生命周期

```
Admin 操作                   系统状态                    用户可见
────────────────────────────────────────────────────────────────
POST /sessions               Session: PENDING
POST /sessions/{s}/rounds    Round: PENDING             可看到轮次，但 status=PENDING
POST .../rounds/{r}/start    Round: ACTIVE   ←─────────  WS 推送 round_state{ACTIVE}
                             ├─ RoundRuntime 创建         前端倒计时开始
                             ├─ 订单簿初始化               可以下单、看行情
                             ├─ 机器人启动
                             └─ 自动结束任务调度

（duration_seconds 后自动，或管理员手动 finish）

POST .../rounds/{r}/finish   Round: FINISHED ←─────────  WS 推送 round_state{FINISHED}
                             ├─ 机器人停止               前端显示 "Round Finished"
                             └─ RoundRuntime 销毁        无法继续下单
```

**Round 结束后的 PnL 计算：**

- **已实现 PnL（Realized）**：每笔成交时实时计算，不受结算价影响
- **未实现 PnL（Unrealized）**：
  - 若该品种配置了 `settlement_price`（如 Round 1 固定 $100）→ 以结算价计算
  - 否则 → 以 Round 结束时的最新成交价（last_price）计算

---

## 7. 文件目录

```
SimuQuant/
│
├── backend/
│   └── app/
│       ├── main.py              # FastAPI 入口，路由注册，admin 初始化
│       ├── config.py            # 配置项（DB URL、机器人默认参数）
│       ├── db.py                # async SQLAlchemy engine + session
│       ├── auth.py              # API Key 认证依赖
│       │
│       ├── api/
│       │   ├── users.py         # POST/GET /users
│       │   ├── sessions.py      # Session + Round CRUD，start/finish
│       │   ├── orders.py        # 下单、撤单、查询
│       │   ├── market.py        # 订单簿快照、仓位、价格历史、排行榜
│       │   ├── etf.py           # ETF 申购赎回 + NAV 查询
│       │   └── ws.py            # WebSocket /ws/{round_id}
│       │
│       ├── core/
│       │   ├── engine.py        # LimitOrderBook（撮合引擎）
│       │   ├── sim.py           # MarketSimulator（GBM + 相关性模拟）
│       │   ├── bots.py          # MarketMakerBot + NoiseTraderBot + BotManager
│       │   ├── session.py       # RoundRuntime + SessionManager（内存状态）
│       │   ├── trade_handler.py # TradeHandler（成交回调：DB写入 + WS推送）
│       │   └── ws_manager.py    # ConnectionManager（WebSocket 广播/定向推送）
│       │
│       └── models/
│           ├── db.py            # SQLAlchemy ORM 模型（5张表 + Enum）
│           └── schemas.py       # Pydantic 请求/响应 Schema
│
├── frontend/
│   └── src/
│       ├── App.tsx              # 路由 + AuthGate + AdminGate
│       ├── api.ts               # 全部 HTTP 调用 + TS 类型定义
│       ├── store/
│       │   ├── authStore.ts     # 用户身份状态
│       │   └── marketStore.ts   # 行情实时状态（WS 驱动）
│       ├── pages/
│       │   ├── LoginPage.tsx    # API Key 登录
│       │   ├── SessionsPage.tsx # Session/Round 列表
│       │   ├── TradePage.tsx    # 交易主界面（4 列布局）
│       │   └── AdminPage.tsx    # 管理员面板（含 ETF/相关性配置）
│       └── components/
│           ├── OrderBook.tsx    # 实时买卖盘
│           ├── PriceChart.tsx   # 价格走势图
│           ├── TradeBlotter.tsx # 最新成交记录
│           ├── Positions.tsx    # 仓位 + PnL 汇总
│           ├── OrderEntry.tsx   # 下单表单（含 per-ticker 规则）
│           ├── ETFPanel.tsx     # ETF NAV + 申购赎回
│           ├── MyOrders.tsx     # 个人挂单 + 撤单
│           └── RoundTimer.tsx   # 倒计时进度条
│
├── sdk/
│   └── simquant/
│       ├── client.py            # SimuQuantClient（HTTP + WS 封装）
│       ├── base_strategy.py     # BaseStrategy（策略基类）
│       ├── types.py             # 数据类型定义
│       └── examples/
│           ├── mm_simple.py     # 简单做市策略示例
│           └── arb_example.py   # ETF 套利策略示例
│
├── docs/
│   ├── PROJECT.md               # 本文档（架构 + 流程）
│   └── API.md                   # 完整 REST/WS API 参考手册
│
├── docker-compose.yml
└── README.md
```
