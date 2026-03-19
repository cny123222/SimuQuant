# SimuQuant — 完整项目文档

> 版本 0.1.0 · 最后更新 2026-03-19

---

## 目录

1. [项目概述](#1-项目概述)
2. [整体架构](#2-整体架构)
3. [目录结构](#3-目录结构)
4. [后端模块详解](#4-后端模块详解)
   - 4.1 [撮合引擎 LimitOrderBook](#41-撮合引擎-limitorderbook)
   - 4.2 [价格模拟器 MarketSimulator](#42-价格模拟器-marketsimulator)
   - 4.3 [机器人系统 BotManager](#43-机器人系统-botmanager)
   - 4.4 [Session / Round 生命周期](#44-session--round-生命周期)
   - 4.5 [Trade Handler](#45-trade-handler)
   - 4.6 [WebSocket 连接管理器](#46-websocket-连接管理器)
   - 4.7 [数据库模型](#47-数据库模型)
   - 4.8 [认证系统](#48-认证系统)
5. [前端模块详解](#5-前端模块详解)
6. [Python SDK 详解](#6-python-sdk-详解)
7. [数据流图](#7-数据流图)
8. [部署指南](#8-部署指南)
9. [开发指南](#9-开发指南)
10. [设计决策与权衡](#10-设计决策与权衡)

---

## 1. 项目概述

SimuQuant 是一个完整的做市交易模拟平台，灵感来自 Optiver、Jump Trading 等量化交易公司的内部训练游戏。平台提供：

- **实时撮合引擎**：基于价格-时间优先级（Price-Time Priority）的 Limit Order Book
- **市场模拟**：GBM（几何布朗运动）+ Poisson 跳跃扩散驱动 fair value
- **机器人做市商**：确保单人也能体验流动性充足的市场
- **Web 前端**：实时 Order Book 可视化、价格图表、持仓 PnL 面板
- **Python SDK**：用户在本地 IDE 编写自动化策略并连接平台

### 核心游戏规则

1. 管理员创建 Session（游戏场）和 Round（交易轮次），配置股票和市场参数
2. 每个 Round 持续固定时间（如 3 分钟），期间做市机器人持续活跃
3. 用户通过 REST 下单或用 Python SDK 自动交易
4. Round 结束时按总 PnL（已实现 + 未实现）排名

---

## 2. 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                     Frontend (React/Vite)                    │
│   LoginPage  SessionsPage  TradePage  AdminPage              │
│   ┌──────────┐  ┌──────────┐  ┌────────────────────────┐   │
│   │OrderBook │  │PriceChart│  │Positions / TradeBlotter│   │
│   └──────────┘  └──────────┘  └────────────────────────┘   │
│          │  Zustand Store  │  WebSocket Hook               │
└──────────┼─────────────────┼──────────────────────────────-─┘
           │ HTTP /api/*     │ ws://.../ws/{round_id}
           ▼                 ▼
┌─────────────────────────────────────────────────────────────┐
│                    Backend (FastAPI)                         │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────┐   │
│  │  REST API   │  │  WS Manager  │  │   Auth (API Key) │   │
│  └──────┬──────┘  └──────┬───────┘  └─────────────────┘   │
│         │                │                                   │
│  ┌──────▼──────────────────▼──────────────────────────┐    │
│  │              Core Engine Layer                      │    │
│  │  ┌────────────────┐  ┌─────────────┐              │    │
│  │  │ LimitOrderBook │  │TradeHandler │              │    │
│  │  │  (per ticker)  │  │(DB + WS cb) │              │    │
│  │  └────────────────┘  └─────────────┘              │    │
│  │  ┌─────────────────┐  ┌────────────────────────┐  │    │
│  │  │ MarketSimulator │  │   BotManager            │  │    │
│  │  │  GBM + Jumps    │  │ MMBot + NoiseBot        │  │    │
│  │  └─────────────────┘  └────────────────────────┘  │    │
│  └─────────────────────────────────────────────────────┘    │
│                        │                                     │
│              ┌─────────▼──────────┐                        │
│              │  SQLite / Postgres  │                        │
│              └────────────────────┘                        │
└─────────────────────────────────────────────────────────────┘
           ▲
           │ HTTP + WebSocket
┌──────────┴──────────────────────────────┐
│  Python SDK (User Strategy)              │
│  SimuQuantClient + BaseStrategy          │
└──────────────────────────────────────────┘
```

---

## 3. 目录结构

```
SimuQuant/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI 入口，lifespan 管理，CORS，路由注册
│   │   ├── config.py            # Pydantic Settings，支持 .env 覆盖
│   │   ├── auth.py              # API Key 认证，generate_api_key()
│   │   ├── db.py                # SQLAlchemy async engine，init_db()，get_db()
│   │   ├── api/
│   │   │   ├── users.py         # POST/GET /users
│   │   │   ├── sessions.py      # Session + Round CRUD，start/finish 逻辑
│   │   │   ├── orders.py        # 下单 / 撤单 / 查询
│   │   │   ├── market.py        # orderbook 快照、positions、price-history、leaderboard
│   │   │   └── ws.py            # WebSocket /ws/{round_id} 端点
│   │   ├── core/
│   │   │   ├── engine.py        # LimitOrderBook，BookOrder，MatchResult，TradeRecord
│   │   │   ├── session.py       # RoundRuntime，SessionManager 单例
│   │   │   ├── sim.py           # TickerSimState，MarketSimulator（GBM + jump）
│   │   │   ├── bots.py          # MarketMakerBot，NoiseTraderBot，BotManager
│   │   │   ├── trade_handler.py # 统一 trade 回调：持仓更新 + DB + WS 广播
│   │   │   └── ws_manager.py    # ConnectionManager，broadcast()，send_to_user()
│   │   └── models/
│   │       ├── db.py            # SQLAlchemy ORM：User, GameSession, Round, Order, Trade, Position
│   │       └── schemas.py       # Pydantic v2 schemas（请求/响应 DTO）
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── main.tsx             # React 入口
│   │   ├── App.tsx              # BrowserRouter，AuthGate，AdminGate
│   │   ├── api.ts               # 所有 HTTP 请求封装，TypeScript 类型定义
│   │   ├── index.css            # Tailwind base + 自定义组件类
│   │   ├── pages/
│   │   │   ├── LoginPage.tsx    # API Key 登录
│   │   │   ├── SessionsPage.tsx # 场次列表，可展开查看轮次
│   │   │   ├── TradePage.tsx    # 主交易界面（4 列网格布局）
│   │   │   └── AdminPage.tsx    # 管理面板：Session/Round 配置、用户管理
│   │   ├── components/
│   │   │   ├── OrderBook.tsx    # 五档 bid/ask 深度可视化
│   │   │   ├── PriceChart.tsx   # Recharts AreaChart 实时价格曲线
│   │   │   ├── TradeBlotter.tsx # 最近成交流水
│   │   │   ├── Positions.tsx    # 持仓汇总表 + 总 PnL
│   │   │   ├── OrderEntry.tsx   # 下单表单（Limit / Market，一键填价）
│   │   │   ├── MyOrders.tsx     # 自己的挂单列表，支持撤单
│   │   │   └── RoundTimer.tsx   # 倒计时进度条
│   │   ├── store/
│   │   │   ├── marketStore.ts   # Zustand：WS 连接、orderBooks、trades、positions
│   │   │   └── authStore.ts     # Zustand：user、apiKey、logout
│   │   └── hooks/               # (预留)
│   ├── package.json
│   ├── vite.config.ts           # Vite dev proxy /api → :8000, /ws → :8000
│   ├── tailwind.config.js
│   └── Dockerfile
├── sdk/
│   ├── simquant/
│   │   ├── __init__.py          # 公开导出
│   │   ├── client.py            # SimuQuantClient（httpx + websockets）
│   │   ├── base_strategy.py     # BaseStrategy ABC
│   │   └── types.py             # OrderBook, Order, Trade, Position, RoundState
│   ├── examples/
│   │   ├── mm_simple.py         # 带 inventory skew 的做市策略
│   │   └── arb_example.py       # Fair-value 偏离套利策略
│   └── setup.py
├── docker-compose.yml
└── README.md
```

---

## 4. 后端模块详解

### 4.1 撮合引擎 LimitOrderBook

**文件**：`backend/app/core/engine.py`

每个 ticker 维护一个独立的 `LimitOrderBook` 实例。

#### 数据结构

```
Bids:  SortedDict{ -price → deque[BookOrder] }   # 升序 key → best bid first
Asks:  SortedDict{ +price → deque[BookOrder] }   # 升序 key → best ask first
```

使用负数 key 存储 bid，使 `SortedDict` 按升序排列时最优 bid 排在最前面，实现 O(log n) 最优价格查找。

#### 撮合算法

**LIMIT 订单**：
1. BUY 方向：遍历 asks（升序），若 `ask_price <= order.price` 则撮合，否则入 book
2. SELL 方向：遍历 bids（升序，即 bid 价格降序），若 `bid_price >= order.price` 则撮合，否则入 book

**MARKET 订单**：
1. 无条件扫对手方最优价格，直到 quantity 耗尽或对手方为空
2. 若对手方为空无法成交，订单状态为 `CANCELLED`

#### 线程安全

每个 book 持有一个 `asyncio.Lock`，所有 `process_order` / `cancel_order` 调用都在 lock 保护下执行，防止并发写冲突。

#### Trade 回调

成交后对每个 `TradeRecord` 调用注册的异步回调列表（通过 `asyncio.create_task` 非阻塞触发），解耦撮合逻辑与 DB/WS 逻辑。

---

### 4.2 价格模拟器 MarketSimulator

**文件**：`backend/app/core/sim.py`

#### 模型

$$
S_{t+dt} = S_t \cdot \exp\left(\left(\mu - \frac{\sigma^2}{2}\right)dt + \sigma\sqrt{dt}\,Z\right) \cdot \exp(J)
$$

其中：
- $\mu$ — drift（每 tick）
- $\sigma$ — volatility（每 tick）
- $Z \sim \mathcal{N}(0,1)$ — 标准正态随机数
- $J$ — 跳跃项：以 Poisson 强度 $\lambda \cdot dt$ 发生，幅度 $\sim \text{Uniform}(-j, +j)$

**参数说明**

| 参数 | 典型值 | 含义 |
|---|---|---|
| `initial_price` | 100.0 | 初始 fair value |
| `volatility` | 0.02 | 每 tick σ（0.02 = 每 0.5s 波动 2%） |
| `drift` | 0.0 | 每 tick μ（0 = 无趋势） |
| `jump_intensity` | 0.01 | 每 tick 发生跳跃的概率 |
| `jump_size` | 0.05 | 跳跃幅度上界（±5%） |

Fair value **不直接影响市价**，仅作为 MarketMakerBot 的报价中枢。

---

### 4.3 机器人系统 BotManager

**文件**：`backend/app/core/bots.py`

#### MarketMakerBot

每个 bot 独立运行一个异步协程，每隔 `tick_interval`（默认 0.5s）：

1. 撤销上一轮报价（`cancel_order`）
2. 从模拟器获取最新 `fair_value`
3. 加随机噪声防止所有 bot 报价相同：`bid = fv - spread/2 + ε`
4. 各提交新的 bid / ask 限价单

#### NoiseTraderBot

每隔 `tick_interval * 3` 随机发一个小市价单（1~5 手），消耗 bid/ask 流动性，模拟真实市场的噪声交易者。

#### BotManager

- 在 Round start 时为每个 ticker 创建 N 个 MM bot + M 个噪声 bot
- 启动价格 tick 循环：每 tick 调用 `sim.tick_all()`，更新 fair value，广播 orderbook_update
- Round finish 时通过 `asyncio.Event` 停止所有 bot 协程

---

### 4.4 Session / Round 生命周期

**文件**：`backend/app/core/session.py`，`backend/app/api/sessions.py`

```
Session 状态机：
  PENDING → ACTIVE → FINISHED

Round 状态机：
  PENDING → ACTIVE → FINISHED
             │
             ├── BotManager.start()
             ├── TradeHandler.attach_to_books()
             └── asyncio.create_task(auto_finish after duration_seconds)
```

**RoundRuntime**（纯内存状态）：
- `books: dict[ticker, LimitOrderBook]` — 每个 ticker 的撮合引擎
- `positions: dict[user_id, dict[ticker, {qty, avg_cost, realized}]]` — 实时持仓
- `price_history: dict[ticker, list[(timestamp, price)]]` — 最近 500 个价格点

Round 结束时 `session_manager.remove_round_runtime(round_id)` 清理内存，持久状态已在 DB 中。

---

### 4.5 Trade Handler

**文件**：`backend/app/core/trade_handler.py`

`TradeHandler.attach_to_books()` 在 Round start 时为每个 book 注册一个统一回调，处理：

1. **更新内存持仓**：加权平均成本、已实现 PnL 计算
2. **DB 持久化**：写入 `trades` 表
3. **公开广播**：`ws_manager.broadcast(round_id, "trade", {...})`
4. **个人推送**：向涉及的 buyer/seller 推送 `position_update`

#### PnL 计算逻辑

```
BUY 成交：
  new_avg_cost = (old_avg_cost × old_qty + price × qty) / (old_qty + qty)
  qty += qty

SELL 成交（平多仓）：
  realized += (price - avg_cost) × qty
  qty -= qty

SELL 成交（开空仓）：
  负数 qty 记录，avg_cost = sell price
```

---

### 4.6 WebSocket 连接管理器

**文件**：`backend/app/core/ws_manager.py`

```python
# 内部结构
_channels: dict[round_id, list[(WebSocket, user_id | None)]]
```

- `broadcast(round_id, type, data)` — 广播给该 round 所有订阅者
- `send_to_user(round_id, user_id, type, data)` — 仅推送给特定用户（持仓更新）

连接断开时自动从 channel 中移除（通过 `send_text` 异常检测）。

---

### 4.7 数据库模型

**文件**：`backend/app/models/db.py`

使用 SQLAlchemy 2.0 async ORM + aiosqlite（开发）/ asyncpg（生产）。

```
users          id, username, api_key, is_admin, created_at
sessions       id, name, status, created_at, started_at, finished_at
rounds         id, session_id, round_number, name, status, duration_seconds,
               tickers_config(JSON), mm_bot_count, noise_bot_count,
               mm_spread, mm_order_size, started_at, finished_at
orders         id, round_id, user_id, bot_id, ticker, side, order_type,
               price, quantity, filled_quantity, status, created_at
trades         id, round_id, ticker, price, quantity,
               buyer_order_id, seller_order_id, aggressor_side, executed_at
positions      id, round_id, user_id, ticker, quantity, realized_pnl, avg_cost
```

> **注**：实时持仓主要在 `RoundRuntime` 内存中维护以保证低延迟；`positions` 表用于 Round 结束后的历史查询（当前版本作为快照预留）。

---

### 4.8 认证系统

**文件**：`backend/app/auth.py`

- 使用 48 字符随机 hex API Key（`secrets.token_hex(24)`）
- 所有请求通过 `X-Api-Key` header 传递
- 两级权限：普通用户（可查询/下单）和管理员（可创建 Session/Round/User）
- 首次启动自动创建 admin 账户并打印 API Key

---

## 5. 前端模块详解

**技术栈**：React 18 + TypeScript + Vite + TailwindCSS + Recharts + Zustand

### 状态管理

```
authStore (Zustand)
  user: User | null
  apiKey: string       ← 持久化到 localStorage
  
marketStore (Zustand)
  ws: WebSocket
  orderBooks: Record<ticker, OrderBookSnapshot>
  recentTrades: Trade[]
  priceHistory: Record<ticker, PricePoint[]>
  positions: Position[]
  round: RoundInfo | null
```

WebSocket 消息在 `marketStore.connectWS()` 中统一 dispatch，各组件通过 Zustand selector 订阅所需状态，实现精准渲染。

### TradePage 布局

```
┌──────────┬────────────────────┬────────────────────┬──────────┐
│          │    PriceChart      │   TradeBlotter     │  Order   │
│OrderBook │                    │                    │  Entry   │
│          ├────────────────────┼────────────────────┤          │
│ (col 1)  │    Positions       │   MyOrders         │ (col 4)  │
│          │                    │                    │          │
└──────────┴────────────────────┴────────────────────┴──────────┘
```

4 列 2 行 CSS Grid，OrderBook 和 OrderEntry 各占满 2 行高度。

### OrderBook 可视化

每档价格后用宽度比例 bar 显示深度（相对于所有档位最大 quantity），bid 绿色 / ask 红色，视觉上一眼看出买卖力量对比。

---

## 6. Python SDK 详解

**文件**：`sdk/simquant/`

### SimuQuantClient

```python
client = SimuQuantClient(host="localhost:8000", api_key="xxx")
```

内部持有：
- `httpx.AsyncClient` — REST 请求
- `websockets.connect` — WS 连接

WS 接收循环在后台协程中运行，收到消息后 dispatch 给注册的回调函数。

### BaseStrategy 执行流程

```
client.run(strategy, session_id, round_id)
  └─ asyncio.run(_run_strategy)
       ├── client.connect(round_id)         # 建立 WS
       ├── strategy.on_start()
       ├── 注册内部回调 → 调用 strategy.on_*
       ├── 等待 round_state.status == FINISHED
       ├── strategy.on_stop()
       └── client.disconnect()
```

### 事件触发顺序（典型）

```
连接成功 → on_start()
每 0.5s  → on_orderbook(ticker, book)  ← 主要交易逻辑在此
成交时   → on_trade(trade)
自己成交 → on_position_update(positions)
轮次结束 → on_round_state(state{FINISHED}) → on_stop()
```

---

## 7. 数据流图

### 下单流程

```
用户 SDK                后端 API              撮合引擎            DB / WS
  │                        │                      │                  │
  │─ POST /orders ─────────►                      │                  │
  │                        │─ 写 Order(OPEN) ─────────────────────── ►DB
  │                        │─ process_order() ────►                  │
  │                        │                      │─ match ──────────►
  │                        │                      │   (if filled)     │
  │                        │                      │─ TradeHandler.on_trade()
  │                        │                      │     ├── update positions (memory)
  │                        │                      │     ├── INSERT Trade ──────────►DB
  │                        │                      │     ├── broadcast "trade" ──────►WS→所有用户
  │                        │                      │     └── send_to_user "position_update" ──►WS→本人
  │                        │─ 更新 Order status ──────────────────── ►DB
  │◄── OrderOut(FILLED) ───│                      │                  │
```

### WS 推送触发链

```
BotManager price tick loop (每 0.5s)
  └─ sim.tick_all()                     # GBM 更新 fair value
  └─ book.snapshot()                    # 获取当前 orderbook 深度
  └─ ws_manager.broadcast("orderbook_update")  # 推送所有订阅者
```

---

## 8. 部署指南

### Docker（生产推荐）

```bash
git clone https://github.com/cny123222/SimuQuant.git
cd SimuQuant
docker-compose up --build -d
```

- 前端：`http://your-server:3000`
- 后端 API：`http://your-server:8000`
- Admin Key 在后端容器日志中：`docker-compose logs backend | grep "API Key"`

### 环境变量（后端）

在 `backend/.env` 中创建：

```env
DATABASE_URL=sqlite+aiosqlite:////data/simquant.db
SECRET_KEY=your-secret-key-here
DEFAULT_MM_BOTS=3
DEFAULT_NOISE_BOTS=2
BOT_TICK_INTERVAL=0.5
```

### 切换 PostgreSQL

```env
DATABASE_URL=postgresql+asyncpg://user:pass@localhost:5432/simquant
```

同时在 `requirements.txt` 加入 `asyncpg`。

---

## 9. 开发指南

### 添加新 API 端点

1. 在 `backend/app/api/` 创建或修改路由文件
2. 在 `backend/app/models/schemas.py` 添加 Pydantic schema
3. 在 `backend/app/main.py` `include_router`
4. 在 `frontend/src/api.ts` 添加对应函数和类型

### 添加新 Bot 类型

1. 在 `backend/app/core/bots.py` 新建 Bot 类，实现 `async run(stop_event)` 方法
2. 在 `BotManager.start()` 中按配置实例化新 Bot
3. 在 Round 配置 schema 中增加对应参数字段

### 运行测试

```bash
# 后端（需安装 pytest + httpx）
cd backend
pip install pytest pytest-asyncio httpx
pytest

# 前端类型检查
cd frontend
npx tsc --noEmit
```

---

## 10. 设计决策与权衡

| 决策 | 选择 | 理由 |
|---|---|---|
| 撮合引擎并发 | asyncio.Lock per book | 无需多进程，单事件循环足够；避免线程锁开销 |
| 实时推送 | FastAPI 原生 WebSocket | 无需 Redis/Kafka，降低部署复杂度 |
| 持仓计算 | 内存中维护 | 亚毫秒延迟；Round 结束前不需要持久化 |
| 价格存储 | 内存环形缓冲（500点） | 避免频繁写 DB；历史查询走内存 |
| 认证 | API Key | 简单直接，适合竞赛场景；无需 OAuth 复杂流程 |
| 数据库 | SQLite（开发）/ PG（生产） | 零配置本地开发；生产一行配置切换 |
| Bot 设计 | 协程 per bot | 每个 bot 完全独立，互不干扰，易于 debug |
| 前端状态 | Zustand | 比 Redux 轻量；比 Context 性能好（selector 精准订阅） |
