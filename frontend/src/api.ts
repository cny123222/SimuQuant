const BASE = '/api'

function headers(): Record<string, string> {
  const key = localStorage.getItem('api_key') || ''
  return { 'Content-Type': 'application/json', 'X-Api-Key': key }
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: headers(),
    body: body != null ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? 'Request failed')
  }
  return res.json()
}

export const api = {
  get: <T>(path: string) => req<T>('GET', path),
  post: <T>(path: string, body?: unknown) => req<T>('POST', path, body),
  delete: <T>(path: string) => req<T>('DELETE', path),

  // auth
  getMe: () => api.get<User>('/users/me'),

  // sessions
  listSessions: () => api.get<Session[]>('/sessions'),
  createSession: (name: string) => api.post<Session>('/sessions', { name }),

  // rounds
  listRounds: (sessionId: number) => api.get<Round[]>(`/sessions/${sessionId}/rounds`),
  createRound: (sessionId: number, body: CreateRoundBody) =>
    api.post<Round>(`/sessions/${sessionId}/rounds`, body),
  startRound: (sessionId: number, roundId: number) =>
    api.post<Round>(`/sessions/${sessionId}/rounds/${roundId}/start`),
  finishRound: (sessionId: number, roundId: number) =>
    api.post<Round>(`/sessions/${sessionId}/rounds/${roundId}/finish`),

  // orders
  placeOrder: (roundId: number, body: PlaceOrderBody) =>
    api.post<Order>(`/rounds/${roundId}/orders`, body),
  cancelOrder: (roundId: number, orderId: number) =>
    api.delete<Order>(`/rounds/${roundId}/orders/${orderId}`),
  getOrders: (roundId: number) => api.get<Order[]>(`/rounds/${roundId}/orders`),
  getTrades: (roundId: number) => api.get<Trade[]>(`/rounds/${roundId}/trades`),

  // market
  getPositions: (roundId: number) => api.get<Position[]>(`/rounds/${roundId}/positions`),
  getLeaderboard: (roundId: number) => api.get<LeaderboardEntry[]>(`/rounds/${roundId}/leaderboard`),
  getPriceHistory: (roundId: number, ticker: string) =>
    api.get<PricePoint[]>(`/rounds/${roundId}/price-history/${ticker}`),

  // ETF
  etfOperate: (roundId: number, ticker: string, body: ETFOperateRequest) =>
    api.post<ETFOperateResult>(`/rounds/${roundId}/etf/${ticker}/operate`, body),
  etfNav: (roundId: number, ticker: string) =>
    api.get<ETFNav>(`/rounds/${roundId}/etf/${ticker}/nav`),

  // users (admin)
  listUsers: () => api.get<User[]>('/users'),
  createUser: (username: string) => api.post<User>('/users', { username }),
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface User {
  id: number
  username: string
  api_key: string
  is_admin: boolean
  created_at: string
}

export interface Session {
  id: number
  name: string
  status: 'PENDING' | 'ACTIVE' | 'FINISHED'
  created_at: string
  started_at: string | null
  finished_at: string | null
}

export interface ETFBasketItem {
  ticker: string
  ratio: number
}

export interface TickerConfig {
  ticker: string
  initial_price: number
  volatility: number
  drift: number
  jump_intensity: number
  jump_size: number
  settlement_price: number | null
  // per-ticker trading rules
  allowed_order_types: string[]  // [] = all allowed
  max_orders_per_second: number | null
  max_order_quantity: number | null
  // correlated price
  price_ref_ticker: string | null
  price_multiplier: number
  residual_volatility: number
  // ETF
  is_etf: boolean
  etf_lot_size: number
  etf_basket: ETFBasketItem[]
  etf_fee: number
}

export interface ETFOperateRequest {
  action: 'CREATE' | 'REDEEM'
  lots: number
}

export interface ETFOperateResult {
  action: string
  lots: number
  etf_ticker: string
  etf_quantity_delta: number
  basket_deltas: Record<string, number>
  fee: number
  positions: Position[]
}

export interface ETFNav {
  etf_ticker: string
  lot_size: number
  fee_per_operation: number
  basket_nav: number
  etf_market_value: number
  arb_spread: number
  create_profitable: boolean
  redeem_profitable: boolean
  basket_detail: Array<{
    ticker: string
    ratio: number
    last_price: number | null
    component_value: number
  }>
}

export interface Round {
  id: number
  session_id: number
  round_number: number
  name: string | null
  status: 'PENDING' | 'ACTIVE' | 'FINISHED'
  duration_seconds: number
  tickers_config: TickerConfig[]
  mm_bot_count: number
  noise_bot_count: number
  mm_spread: number
  mm_order_size: number
  order_fee: number
  max_order_quantity: number
  max_orders_per_second: number
  started_at: string | null
  finished_at: string | null
}

export interface CreateRoundBody {
  round_number: number
  name?: string
  duration_seconds: number
  tickers_config: TickerConfig[]
  mm_bot_count: number
  noise_bot_count: number
  mm_spread: number
  mm_order_size: number
  order_fee: number
  max_order_quantity: number
  max_orders_per_second: number
}

export interface PlaceOrderBody {
  ticker: string
  side: 'BUY' | 'SELL'
  order_type: 'LIMIT' | 'MARKET' | 'IOC'
  price?: number
  quantity: number
}

export interface Order {
  id: number
  round_id: number
  user_id: number
  ticker: string
  side: 'BUY' | 'SELL'
  order_type: 'LIMIT' | 'MARKET' | 'IOC'
  price: number | null
  quantity: number
  filled_quantity: number
  status: 'OPEN' | 'PARTIAL' | 'FILLED' | 'CANCELLED'
  created_at: string
}

export interface Trade {
  id: number
  round_id: number
  ticker: string
  price: number
  quantity: number
  aggressor_side: 'BUY' | 'SELL'
  executed_at: string
}

export interface Position {
  ticker: string
  quantity: number
  avg_cost: number
  realized_pnl: number
  settlement_price?: number | null
  fees_paid?: number
  unrealized_pnl: number
  total_pnl: number
}

export interface LeaderboardEntry {
  rank: number
  username: string
  total_pnl: number
  realized_pnl: number
  unrealized_pnl: number
}

export interface PriceLevel {
  price: number
  quantity: number
}

export interface OrderBookSnapshot {
  ticker: string
  bids: PriceLevel[]
  asks: PriceLevel[]
  last_price: number | null
  fair_value: number | null
  timestamp: string
}

export interface PricePoint {
  timestamp: string
  price: number
}
