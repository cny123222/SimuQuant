import { create } from 'zustand'
import type { OrderBookSnapshot, Trade, Position, PricePoint } from '../api'

interface RoundInfo {
  roundId: number
  status: 'ACTIVE' | 'FINISHED'
  durationSeconds: number
  tickers: string[]
  startedAt: number  // Date.now() when ACTIVE received
}

interface MarketState {
  // WebSocket
  ws: WebSocket | null
  connected: boolean

  // Round
  round: RoundInfo | null

  // Market data
  orderBooks: Record<string, OrderBookSnapshot>
  recentTrades: Trade[]
  priceHistory: Record<string, PricePoint[]>

  // Own state
  positions: Position[]
  myOrders: import('../api').Order[]

  // Actions
  connectWS: (roundId: number, apiKey: string) => void
  disconnectWS: () => void
  setPositions: (p: Position[]) => void
  setMyOrders: (o: import('../api').Order[]) => void
  appendPricePoint: (ticker: string, price: number, ts: string) => void
}

export const useMarketStore = create<MarketState>((set, get) => ({
  ws: null,
  connected: false,
  round: null,
  orderBooks: {},
  recentTrades: [],
  priceHistory: {},
  positions: [],
  myOrders: [],

  connectWS: (roundId, apiKey) => {
    const { ws } = get()
    if (ws) ws.close()

    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const socket = new WebSocket(`${proto}://${location.host}/ws/${roundId}?api_key=${apiKey}`)

    socket.onopen = () => set({ connected: true })
    socket.onclose = () => set({ connected: false, ws: null })

    socket.onmessage = (e) => {
      const msg = JSON.parse(e.data) as { type: string; data: unknown }
      const { type, data } = msg

      if (type === 'orderbook_update') {
        const snap = data as OrderBookSnapshot
        set((s) => ({
          orderBooks: { ...s.orderBooks, [snap.ticker]: snap },
        }))
        // Append to price history if last_price available
        if (snap.last_price != null) {
          get().appendPricePoint(snap.ticker, snap.last_price, snap.timestamp)
        }
      } else if (type === 'trade') {
        const trade = data as Trade
        set((s) => ({
          recentTrades: [trade, ...s.recentTrades].slice(0, 100),
        }))
      } else if (type === 'position_update') {
        set({ positions: data as Position[] })
      } else if (type === 'round_state') {
        const d = data as { round_id: number; status: string; duration_seconds?: number; tickers?: string[] }
        set({
          round: {
            roundId: d.round_id,
            status: d.status as 'ACTIVE' | 'FINISHED',
            durationSeconds: d.duration_seconds ?? 0,
            tickers: d.tickers ?? [],
            startedAt: Date.now(),
          },
        })
      }
    }

    set({ ws: socket, round: null })
  },

  disconnectWS: () => {
    const { ws } = get()
    ws?.close()
    set({ ws: null, connected: false, round: null })
  },

  setPositions: (positions) => set({ positions }),
  setMyOrders: (myOrders) => set({ myOrders }),

  appendPricePoint: (ticker, price, ts) => {
    set((s) => {
      const prev = s.priceHistory[ticker] ?? []
      const next = [...prev, { timestamp: ts, price }].slice(-300)
      return { priceHistory: { ...s.priceHistory, [ticker]: next } }
    })
  },
}))
