# SimuQuant — 管理员操作手册

> 适用对象：负责创建和管理游戏场次的管理员

---

## 目录

1. [认证](#1-认证)
2. [快速上手：一个完整 Round 的创建流程](#2-快速上手一个完整-round-的创建流程)
3. [用户管理](#3-用户管理)
4. [Session 管理](#4-session-管理)
5. [Round 管理](#5-round-管理)
6. [Round 配置详解](#6-round-配置详解)
   - [基础配置](#61-基础配置)
   - [品种配置 tickers_config](#62-品种配置-tickers_config)
   - [机器人配置](#63-机器人配置)
   - [交易规则配置](#64-交易规则配置)
   - [Per-ticker 规则](#65-per-ticker-规则)
   - [相关性价格模拟](#66-相关性价格模拟)
   - [ETF 配置](#67-etf-配置)
7. [场景配置示例](#7-场景配置示例)
   - [Round 1：单品种固定结算](#71-round-1单品种固定结算)
   - [Round 3：双品种相关性](#72-round-3双品种相关性)
   - [Round 4：ETF 套利](#73-round-4etf-套利)
8. [API 完整参考](#8-api-完整参考)

---

## 1. 认证

所有 API 请求均需在 Header 中携带 API Key：

```
X-Api-Key: <your-admin-api-key>
```

管理员账号在后端首次启动时自动创建，API Key 打印在服务端日志中：

```
INFO:     Admin API key: a1b2c3d4e5f6...
```

> **注意：** 普通用户的 API Key 由管理员通过 `POST /api/users` 创建后颁发，用户无法自行注册。

---

## 2. 快速上手：一个完整 Round 的创建流程

```bash
BASE="http://localhost:8000/api"
KEY="your-admin-api-key"

# 1. 创建 Session（一场游戏）
SESSION=$(curl -s -X POST $BASE/sessions \
  -H "X-Api-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"name": "Jump Trading 练习赛"}')
SESSION_ID=$(echo $SESSION | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")

# 2. 创建 Round（一个轮次）
ROUND=$(curl -s -X POST $BASE/sessions/$SESSION_ID/rounds \
  -H "X-Api-Key: $KEY" -H "Content-Type: application/json" \
  -d '{
    "round_number": 1,
    "name": "Round 1",
    "duration_seconds": 300,
    "tickers_config": [{"ticker": "PRODA", "initial_price": 100}],
    "mm_bot_count": 3,
    "noise_bot_count": 2,
    "mm_spread": 0.1,
    "mm_order_size": 10
  }')
ROUND_ID=$(echo $ROUND | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")

# 3. 创建用户
curl -s -X POST $BASE/users \
  -H "X-Api-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"username": "alice"}' | python3 -m json.tool

# 4. 启动 Round（机器人开始运行，用户可以交易）
curl -s -X POST $BASE/sessions/$SESSION_ID/rounds/$ROUND_ID/start \
  -H "X-Api-Key: $KEY"

# 5. 提前结束（可选；否则等 duration_seconds 后自动结束）
curl -s -X POST $BASE/sessions/$SESSION_ID/rounds/$ROUND_ID/finish \
  -H "X-Api-Key: $KEY"
```

---

## 3. 用户管理

### 创建用户

```http
POST /api/users
```

```json
{ "username": "alice" }
```

**响应：**
```json
{
  "id": 2,
  "username": "alice",
  "api_key": "a1b2c3...",
  "is_admin": false,
  "created_at": "2026-03-19T10:00:00"
}
```

> `api_key` 仅在创建时返回一次，请立即告知用户保存。

---

### 查看所有用户

```http
GET /api/users
```

---

### 查看当前用户

```http
GET /api/users/me
```

---

## 4. Session 管理

Session 是一场完整的游戏，可以包含多个 Round。

### 创建 Session

```http
POST /api/sessions
```

```json
{ "name": "模拟做市大赛 Vol.1" }
```

### 列出所有 Session

```http
GET /api/sessions
```

### 查看单个 Session

```http
GET /api/sessions/{session_id}
```

---

## 5. Round 管理

### 创建 Round

```http
POST /api/sessions/{session_id}/rounds
```

请求体见 [§6 Round 配置详解](#6-round-配置详解)。

### 启动 Round

```http
POST /api/sessions/{session_id}/rounds/{round_id}/start
```

启动后会发生：
- Round status → `ACTIVE`
- 所有配置的机器人开始运行
- 价格模拟器开始 tick
- 向所有已连接的 WebSocket 客户端广播 `round_state{ACTIVE}`
- 计时开始，`duration_seconds` 后自动结束

### 提前结束 Round

```http
POST /api/sessions/{session_id}/rounds/{round_id}/finish
```

### 列出 Session 下的所有 Round

```http
GET /api/sessions/{session_id}/rounds
```

---

## 6. Round 配置详解

### 6.1 基础配置

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `round_number` | int | 必填 | 轮次编号（1, 2, 3...） |
| `name` | string | null | 轮次名称（显示用） |
| `duration_seconds` | int | 180 | 轮次持续时间（秒） |

---

### 6.2 品种配置 `tickers_config`

每个品种是一个 JSON 对象。最简配置只需填 `ticker`：

```json
{"ticker": "PRODA"}
```

**完整字段：**

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `ticker` | string | 必填 | 品种代码（大写，如 `"PRODA"`） |
| `initial_price` | float | `100.0` | 初始公允价值 |
| `volatility` | float | `0.02` | GBM 波动率 σ（每 tick） |
| `drift` | float | `0.0` | GBM 漂移率 μ（每 tick） |
| `jump_intensity` | float | `0.01` | 价格跳跃泊松强度 λ |
| `jump_size` | float | `0.05` | 价格跳跃幅度（相对） |
| `settlement_price` | float\|null | `null` | 固定结算价；null = 以最后成交价结算 |

**价格参数参考（per-tick，约 0.5 秒）：**

| 场景 | `volatility` | `jump_intensity` |
|---|---|---|
| 平静市场 | 0.005 | 0.005 |
| 正常市场 | 0.02 | 0.01 |
| 剧烈波动 | 0.05 | 0.05 |

---

### 6.3 机器人配置

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `mm_bot_count` | int | 3 | 做市商机器人数量（提供双边报价） |
| `noise_bot_count` | int | 2 | 噪声交易者数量（随机市价单） |
| `mm_spread` | float | 0.1 | 做市商报价价差（BID 和 ASK 之差） |
| `mm_order_size` | int | 10 | 做市商每次报价的单笔数量 |

**建议配置：**

| 目标效果 | `mm_bot_count` | `noise_bot_count` | `mm_spread` |
|---|---|---|---|
| 流动性好、价差窄 | 5 | 3 | 0.05 |
| 标准场景 | 3 | 2 | 0.10 |
| 流动性差、价差宽 | 1 | 3 | 0.50 |

---

### 6.4 交易规则配置（Round 级别）

这些规则对所有品种生效，可被 per-ticker 规则覆盖。

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `order_fee` | float | 0.0 | 每笔下单扣除的固定手续费（从实现 PnL 扣除） |
| `max_order_quantity` | int | 0 | 单笔最大数量；0 = 不限 |
| `max_orders_per_second` | int | 0 | 每秒最大下单笔数；0 = 不限 |

---

### 6.5 Per-ticker 规则

在 `tickers_config` 的每个品种对象中设置，优先级高于 Round 级别的规则：

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `allowed_order_types` | list[string] | `[]` | 允许的订单类型；`[]` = 全部允许 |
| `max_order_quantity` | int\|null | `null` | 该品种的最大单笔数量；null = 用 Round 设置 |
| `max_orders_per_second` | int\|null | `null` | 该品种的每秒限速；null = 用 Round 设置 |

`allowed_order_types` 可选值：`"LIMIT"`、`"MARKET"`、`"IOC"`

**示例（品种 B 只允许 IOC，品种 C 允许 IOC 和 LIMIT）：**

```json
"tickers_config": [
  {
    "ticker": "PRODB",
    "initial_price": 100,
    "allowed_order_types": ["IOC"],
    "max_order_quantity": 5,
    "max_orders_per_second": 20
  },
  {
    "ticker": "PRODC",
    "initial_price": 200,
    "allowed_order_types": ["IOC", "LIMIT"],
    "max_order_quantity": 5,
    "max_orders_per_second": 10
  }
]
```

---

### 6.6 相关性价格模拟

让一个品种的公允价值锚定在另一个品种的倍数上（适用于 Round 3 / Round 4 场景）：

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `price_ref_ticker` | string\|null | `null` | 参考品种的 ticker（必须在同一 Round 中） |
| `price_multiplier` | float | 1.0 | 目标价值 = multiplier × 参考品种公允价值 |
| `residual_volatility` | float | 0.005 | 相关性品种围绕锚定价格的额外随机噪声 |

**机制：** 每个 tick，C 的公允价值以 0.3 的强度均值回归到 `price_multiplier × B` 并叠加残差噪声，制造价格偏离和套利机会。

**示例（C 的公允价值 = 2 × B）：**

```json
{
  "ticker": "PRODC",
  "initial_price": 200,
  "price_ref_ticker": "PRODB",
  "price_multiplier": 2.0,
  "residual_volatility": 0.008
}
```

---

### 6.7 ETF 配置

将一个品种设置为可申购赎回的 ETF（适用于 Round 4 场景）：

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `is_etf` | bool | `false` | 是否为 ETF |
| `etf_lot_size` | int | 10 | 每次申购/赎回的 ETF 单位数 |
| `etf_basket` | list[dict] | `[]` | 篮子成分：`[{"ticker": "X", "ratio": N}, ...]` |
| `etf_fee` | float | 0.0 | 每次申购/赎回的固定手续费 |

**申购（CREATE）：** 用户交出 `ratio × lots` 份各成分品种 → 获得 `etf_lot_size × lots` 份 ETF

**赎回（REDEEM）：** 用户交出 `etf_lot_size × lots` 份 ETF → 获得 `ratio × lots` 份各成分品种

**示例（10E ⟺ 2A + 3C + 4D，手续费 $10）：**

```json
{
  "ticker": "PRODE",
  "initial_price": 47,
  "is_etf": true,
  "etf_lot_size": 10,
  "etf_basket": [
    {"ticker": "PRODA", "ratio": 2},
    {"ticker": "PRODC", "ratio": 3},
    {"ticker": "PRODD", "ratio": 4}
  ],
  "etf_fee": 10.0
}
```

---

## 7. 场景配置示例

### 7.1 Round 1：单品种固定结算

```json
{
  "round_number": 1,
  "name": "Round 1 — Single Product",
  "duration_seconds": 300,
  "tickers_config": [
    {
      "ticker": "PRODA",
      "initial_price": 100,
      "volatility": 0.015,
      "settlement_price": 100,
      "allowed_order_types": ["IOC"],
      "max_order_quantity": 5,
      "max_orders_per_second": 5
    }
  ],
  "mm_bot_count": 3,
  "noise_bot_count": 2,
  "mm_spread": 0.1,
  "mm_order_size": 10,
  "order_fee": 0.2
}
```

**特点：** 只有 IOC 订单，固定结算价 100，每笔下单 $0.2 手续费，单笔限量 5

---

### 7.2 Round 3：双品种相关性

```json
{
  "round_number": 3,
  "name": "Round 3 — Correlated Pair",
  "duration_seconds": 300,
  "tickers_config": [
    {
      "ticker": "PRODB",
      "initial_price": 100,
      "volatility": 0.02,
      "allowed_order_types": ["IOC"],
      "max_order_quantity": 5,
      "max_orders_per_second": 20
    },
    {
      "ticker": "PRODC",
      "initial_price": 200,
      "volatility": 0.02,
      "price_ref_ticker": "PRODB",
      "price_multiplier": 2.0,
      "residual_volatility": 0.008,
      "allowed_order_types": ["IOC", "LIMIT"],
      "max_order_quantity": 5,
      "max_orders_per_second": 10
    }
  ],
  "mm_bot_count": 4,
  "noise_bot_count": 3,
  "mm_spread": 0.15,
  "mm_order_size": 8
}
```

**特点：**
- B 只允许 IOC，C 允许 IOC + 限价单
- C 的公允价值保证约等于 2 × B，偏离即为套利机会
- B 每秒限 20 笔，C 每秒限 10 笔

---

### 7.3 Round 4：ETF 套利

```json
{
  "round_number": 4,
  "name": "Round 4 — ETF Arbitrage",
  "duration_seconds": 300,
  "tickers_config": [
    {
      "ticker": "PRODA",
      "initial_price": 100,
      "volatility": 0.02,
      "allowed_order_types": ["IOC", "LIMIT"],
      "max_order_quantity": 5
    },
    {
      "ticker": "PRODC",
      "initial_price": 50,
      "volatility": 0.02,
      "allowed_order_types": ["IOC", "LIMIT"],
      "max_order_quantity": 5
    },
    {
      "ticker": "PRODD",
      "initial_price": 30,
      "volatility": 0.02,
      "allowed_order_types": ["IOC", "LIMIT"],
      "max_order_quantity": 5,
      "max_orders_per_second": 20
    },
    {
      "ticker": "PRODE",
      "initial_price": 47,
      "volatility": 0.02,
      "is_etf": true,
      "etf_lot_size": 10,
      "etf_basket": [
        {"ticker": "PRODA", "ratio": 2},
        {"ticker": "PRODC", "ratio": 3},
        {"ticker": "PRODD", "ratio": 4}
      ],
      "etf_fee": 10.0,
      "allowed_order_types": ["IOC", "LIMIT"],
      "max_order_quantity": 5,
      "max_orders_per_second": 10
    }
  ],
  "mm_bot_count": 4,
  "noise_bot_count": 3,
  "mm_spread": 0.2,
  "mm_order_size": 5
}
```

**特点：**
- 10E ⟺ 2A + 3C + 4D，每次申赎 $10 手续费
- 当 E 市场价偏离篮子 NAV 超过 $10 时，套利有利可图

---

## 8. API 完整参考

### 认证

所有端点需 Header：`X-Api-Key: <key>`

---

### 用户

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| `POST` | `/api/users` | Admin | 创建用户，返回含 `api_key` 的 `UserOut` |
| `GET` | `/api/users` | Admin | 列出所有用户 |
| `GET` | `/api/users/me` | Any | 查看当前用户信息 |

---

### Session

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| `POST` | `/api/sessions` | Admin | 创建 Session |
| `GET` | `/api/sessions` | Any | 列出所有 Session（按创建时间降序） |
| `GET` | `/api/sessions/{id}` | Any | 查看单个 Session |

---

### Round

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| `POST` | `/api/sessions/{s}/rounds` | Admin | 创建 Round |
| `GET` | `/api/sessions/{s}/rounds` | Any | 列出 Session 下所有 Round |
| `GET` | `/api/sessions/{s}/rounds/{r}` | Any | 查看单个 Round |
| `POST` | `/api/sessions/{s}/rounds/{r}/start` | Admin | 启动 Round |
| `POST` | `/api/sessions/{s}/rounds/{r}/finish` | Admin | 提前结束 Round |

---

### 排行榜（管理员常用）

```http
GET /api/rounds/{round_id}/leaderboard
```

响应：
```json
[
  {"rank": 1, "username": "alice", "total_pnl": 123.45, "realized_pnl": 100.0, "unrealized_pnl": 23.45},
  {"rank": 2, "username": "bob",   "total_pnl":  89.10, "realized_pnl":  89.1, "unrealized_pnl":   0.0}
]
```

---

### 订单（查看所有用户的成交，管理员视角）

```http
GET /api/rounds/{round_id}/trades
```

返回最近 200 笔成交（所有用户 + 机器人）。

---

### 健康检查

```http
GET /api/health
→ {"status": "ok", "service": "SimuQuant"}
```
