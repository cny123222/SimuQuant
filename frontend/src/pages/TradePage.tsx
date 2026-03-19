import { useEffect, useState, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { api, type Round } from '../api'
import { useMarketStore } from '../store/marketStore'
import { useAuthStore } from '../store/authStore'
import { OrderBook } from '../components/OrderBook'
import { PriceChart } from '../components/PriceChart'
import { TradeBlotter } from '../components/TradeBlotter'
import { Positions } from '../components/Positions'
import { OrderEntry } from '../components/OrderEntry'
import { ETFPanel } from '../components/ETFPanel'
import { MyOrders } from '../components/MyOrders'
import { RoundTimer } from '../components/RoundTimer'

export function TradePage() {
  const { roundId } = useParams<{ roundId: string }>()
  const rid = parseInt(roundId ?? '0')

  const apiKey = useAuthStore((s) => s.apiKey)
  const { connectWS, disconnectWS, orderBooks, recentTrades, priceHistory, positions, connected } =
    useMarketStore()

  const [round, setRound] = useState<Round | null>(null)
  const [myOrders, setMyOrders] = useState<import('../api').Order[]>([])
  const [activeTicker, setActiveTicker] = useState<string>('')
  const [loading, setLoading] = useState(true)

  const loadOrders = useCallback(async () => {
    try {
      const orders = await api.getOrders(rid)
      setMyOrders(orders)
    } catch { /* ignore */ }
  }, [rid])

  useEffect(() => {
    if (!rid) return
    ;(async () => {
      try {
        // Find session for this round (search through sessions)
        const sessions = await api.listSessions()
        let foundRound: Round | null = null
        for (const s of sessions) {
          const rounds = await api.listRounds(s.id)
          foundRound = rounds.find((r) => r.id === rid) ?? null
          if (foundRound) break
        }
        setRound(foundRound)
        if (foundRound?.tickers_config[0]) {
          setActiveTicker(foundRound.tickers_config[0].ticker)
        }
        await loadOrders()
      } finally {
        setLoading(false)
      }
    })()
  }, [rid, loadOrders])

  useEffect(() => {
    if (rid && apiKey) {
      connectWS(rid, apiKey)
    }
    return () => disconnectWS()
  }, [rid, apiKey, connectWS, disconnectWS])

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-muted">Loading…</div>
    )
  }

  if (!round) {
    return (
      <div className="h-full flex items-center justify-center flex-col gap-4">
        <div className="text-muted">Round not found</div>
        <Link to="/" className="btn-ghost btn">← Back</Link>
      </div>
    )
  }

  const tickers = round.tickers_config.map((tc) => tc.ticker)
  const fairValue = orderBooks[activeTicker]?.fair_value ?? undefined

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Top bar */}
      <header className="h-12 border-b border-border flex items-center px-4 gap-4 shrink-0">
        <Link to="/" className="text-muted hover:text-white text-sm">← Sessions</Link>
        <span className="text-white font-semibold">{round.name ?? `Round ${round.round_number}`}</span>
        <div className="flex gap-1 ml-2">
          {tickers.map((t) => (
            <button
              key={t}
              onClick={() => setActiveTicker(t)}
              className={`text-xs px-2 py-0.5 rounded ${activeTicker === t ? 'bg-accent text-black' : 'btn-ghost'}`}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-4">
          <div className={`w-2 h-2 rounded-full ${connected ? 'bg-buy' : 'bg-sell'}`} title={connected ? 'Connected' : 'Disconnected'} />
          <RoundTimer />
        </div>
      </header>

      {/* Main grid */}
      <div className="flex-1 overflow-hidden grid gap-2 p-2" style={{
        gridTemplateColumns: '220px 1fr 1fr 220px',
        gridTemplateRows: '1fr 1fr',
      }}>
        {/* Col 1: Order Book */}
        <div className="row-span-2">
          <OrderBook snapshot={orderBooks[activeTicker]} ticker={activeTicker} />
        </div>

        {/* Col 2: Price Chart */}
        <PriceChart
          data={priceHistory[activeTicker] ?? []}
          ticker={activeTicker}
          fairValue={fairValue}
        />

        {/* Col 3: Trade Blotter */}
        <TradeBlotter trades={recentTrades.filter((t) => !activeTicker || t.ticker === activeTicker)} />

        {/* Col 2 row 2: Positions */}
        <Positions positions={positions} />

        {/* Col 3 row 2: My Orders */}
        <MyOrders roundId={rid} orders={myOrders} onCancel={loadOrders} />

        {/* Col 4: Order Entry + ETF Panel */}
        <div className="row-span-2 flex flex-col gap-2 overflow-y-auto">
          {round.status === 'ACTIVE' && (
            <>
              <OrderEntry roundId={rid} round={round} onOrderPlaced={loadOrders} />
              <ETFPanel roundId={rid} round={round} />
            </>
          )}
          {round.status !== 'ACTIVE' && (
            <div className="panel p-4 text-center text-muted text-xs">
              Round is {round.status}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
