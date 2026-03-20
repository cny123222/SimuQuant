/**
 * ViewerPage – read-only market monitoring page.
 *
 * Layout:
 *   ┌──────────────────────────────────────────────────────────┐
 *   │ ← Back | Session/Round name | tickers | ● Connected     │ header
 *   ├──────────────────┬───────────────────────────────────────┤
 *   │  Price: SJTU-A   │         Price: SJTU-B               │ charts row
 *   ├──────────┬────────────────────────────────────────────── ┤
 *   │ OrderBook│  Trade Blotter (all tickers, all trades)     │ bottom row
 *   │ [A][B]   │                                              │
 *   └──────────┴───────────────────────────────────────────────┘
 */
import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { useMarketStore } from '../store/marketStore'
import { api } from '../api'
import { PriceChart } from '../components/PriceChart'
import { OrderBook } from '../components/OrderBook'
import { TradeBlotter } from '../components/TradeBlotter'

export function ViewerPage() {
  const { roundId: roundIdStr } = useParams<{ roundId: string }>()
  const roundId = Number(roundIdStr)
  const { apiKey } = useAuthStore()

  const { connected, round, orderBooks, recentTrades, priceHistory, connectWS, disconnectWS } =
    useMarketStore()

  const [roundName, setRoundName] = useState<string>('')
  const [selectedTicker, setSelectedTicker] = useState<string>('')

  // Connect WebSocket on mount
  useEffect(() => {
    if (!apiKey) return
    connectWS(roundId, apiKey)
    return () => disconnectWS()
  }, [roundId, apiKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load round info for display name
  useEffect(() => {
    api.listSessions().then(async (sessions) => {
      for (const session of sessions) {
        const rounds = await api.listRounds(session.id)
        const r = rounds.find((r) => r.id === roundId)
        if (r) {
          setRoundName(r.name ? `${session.name} · ${r.name}` : session.name)
          break
        }
      }
    })
  }, [roundId])

  const tickers = round?.tickers ?? []

  // Auto-select first ticker when tickers arrive
  useEffect(() => {
    if (tickers.length > 0 && !selectedTicker) {
      setSelectedTicker(tickers[0])
    }
  }, [tickers, selectedTicker])

  const statusDot = connected
    ? 'bg-buy'
    : 'bg-gray-500'

  // Split tickers into pairs of charts (up to 4 tickers shown as 2-column grid)
  const chartTickers = tickers.slice(0, 4)

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-bg text-white">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <header className="h-12 border-b border-border flex items-center px-4 gap-3 shrink-0">
        <Link to="/" className="text-muted hover:text-white transition-colors text-sm">
          ← Back
        </Link>
        <span className="text-border">|</span>
        <span className="font-semibold text-white truncate">
          {roundName || `Round #${roundId}`}
        </span>

        {tickers.length > 0 && (
          <>
            <span className="text-border">|</span>
            <div className="flex gap-2">
              {tickers.map((t) => (
                <span key={t} className="text-xs mono text-accent">{t}</span>
              ))}
            </div>
          </>
        )}

        <div className="ml-auto flex items-center gap-2 text-xs">
          <div className={`w-2 h-2 rounded-full ${statusDot}`} />
          <span className="text-muted">{connected ? 'Connected' : 'Disconnected'}</span>
        </div>
      </header>

      {/* ── Body ────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden flex flex-col gap-px bg-border/30 p-px">

        {/* Row 1: Price Charts */}
        <div
          className="flex gap-px bg-border/30"
          style={{ height: chartTickers.length > 0 ? '38%' : '0%', minHeight: chartTickers.length > 0 ? '160px' : '0px' }}
        >
          {chartTickers.length === 0 ? (
            <div className="flex-1 bg-panel flex items-center justify-center text-muted text-xs">
              Waiting for round to start…
            </div>
          ) : (
            <div className="flex-1 bg-panel overflow-hidden">
              <PriceChart
                allPriceHistory={priceHistory}
                tickers={chartTickers}
                activeTicker={selectedTicker || chartTickers[0]}
              />
            </div>
          )}
        </div>

        {/* Row 2: OrderBook + TradeBlotter */}
        <div className="flex-1 flex gap-px bg-border/30 overflow-hidden">

          {/* Left: tabbed OrderBook */}
          <div className="w-56 shrink-0 bg-panel flex flex-col overflow-hidden">
            {/* Ticker tabs */}
            <div className="flex border-b border-border shrink-0">
              {tickers.map((t) => (
                <button
                  key={t}
                  onClick={() => setSelectedTicker(t)}
                  className={`flex-1 py-1.5 text-xs mono transition-colors ${
                    selectedTicker === t
                      ? 'text-white border-b-2 border-accent'
                      : 'text-muted hover:text-white'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>

            {/* Order book content */}
            <div className="flex-1 overflow-hidden">
              {selectedTicker ? (
                <OrderBook
                  snapshot={orderBooks[selectedTicker]}
                  ticker={selectedTicker}
                />
              ) : (
                <div className="h-full flex items-center justify-center text-muted text-xs">
                  Select a ticker
                </div>
              )}
            </div>
          </div>

          {/* Right: Trade Blotter (all tickers) */}
          <div className="flex-1 bg-panel overflow-hidden">
            <TradeBlotter trades={recentTrades} />
          </div>
        </div>
      </div>
    </div>
  )
}
