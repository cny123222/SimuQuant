/**
 * ETF Creation / Redemption panel.
 *
 * Shows for any ticker marked is_etf=true.
 * Displays:
 *  - basket composition (10E ⟺ 2A + 3C + 4D)
 *  - live NAV vs market price, arb spread
 *  - create / redeem buttons with lot input
 */
import { useCallback, useEffect, useState } from 'react'
import { api, type ETFNav, type Round } from '../api'

interface Props {
  roundId: number
  round: Round
}

export function ETFPanel({ roundId, round }: Props) {
  const etfTickers = round.tickers_config.filter((tc) => tc.is_etf)
  if (etfTickers.length === 0) return null

  return (
    <div className="panel">
      <div className="panel-header">ETF 申购 / 赎回</div>
      <div className="divide-y divide-border">
        {etfTickers.map((tc) => (
          <ETFTickerSection key={tc.ticker} roundId={roundId} tc={tc} />
        ))}
      </div>
    </div>
  )
}

function ETFTickerSection({
  roundId,
  tc,
}: {
  roundId: number
  tc: Round['tickers_config'][number]
}) {
  const [nav, setNav] = useState<ETFNav | null>(null)
  const [lots, setLots] = useState(1)
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null)

  const fetchNav = useCallback(async () => {
    try {
      const n = await api.etfNav(roundId, tc.ticker)
      setNav(n)
    } catch {
      // round may not be active yet
    }
  }, [roundId, tc.ticker])

  useEffect(() => {
    fetchNav()
    const id = setInterval(fetchNav, 2000)
    return () => clearInterval(id)
  }, [fetchNav])

  async function operate(action: 'CREATE' | 'REDEEM') {
    setMsg(null)
    setLoading(true)
    try {
      const res = await api.etfOperate(roundId, tc.ticker, { action, lots })
      const delta = res.etf_quantity_delta
      const basketStr = Object.entries(res.basket_deltas)
        .map(([t, d]) => `${d > 0 ? '+' : ''}${d} ${t}`)
        .join(', ')
      setMsg({
        text: `${action}: ${delta > 0 ? '+' : ''}${delta} ${tc.ticker} | ${basketStr} | fee -${res.fee}`,
        ok: true,
      })
    } catch (e: unknown) {
      setMsg({ text: e instanceof Error ? e.message : 'Failed', ok: false })
    } finally {
      setLoading(false)
    }
  }

  // Build basket formula string: "10E ⟺ 2A + 3C + 4D"
  const basketFormula = tc.etf_basket
    .map((b) => `${b.ratio}${b.ticker}`)
    .join(' + ')
  const formula = `${tc.etf_lot_size}${tc.ticker} ⟺ ${basketFormula}`

  return (
    <div className="p-3 space-y-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-white font-semibold">{tc.ticker}</span>
        <span className="text-xs text-muted mono">{formula}</span>
      </div>

      {/* NAV / Arb display */}
      {nav && (
        <div className="bg-surface rounded p-2 text-xs space-y-1 border border-border/60">
          <div className="flex justify-between text-muted">
            <span>Basket NAV (1 lot)</span>
            <span className="mono text-white">{nav.basket_nav.toFixed(3)}</span>
          </div>
          <div className="flex justify-between text-muted">
            <span>ETF Market ({nav.lot_size} units)</span>
            <span className="mono text-white">{nav.etf_market_value.toFixed(3)}</span>
          </div>
          <div className="flex justify-between font-semibold">
            <span className="text-muted">Arb Spread</span>
            <span className={`mono ${nav.arb_spread > 0 ? 'text-buy' : nav.arb_spread < 0 ? 'text-sell' : 'text-muted'}`}>
              {nav.arb_spread >= 0 ? '+' : ''}{nav.arb_spread.toFixed(3)}
            </span>
          </div>
          <div className="border-t border-border/40 pt-1 flex gap-3">
            {nav.create_profitable && (
              <span className="text-buy">▲ CREATE arb opportunity</span>
            )}
            {nav.redeem_profitable && (
              <span className="text-sell">▼ REDEEM arb opportunity</span>
            )}
            {!nav.create_profitable && !nav.redeem_profitable && (
              <span className="text-muted">No arb (spread {'<'} fee {nav.fee_per_operation})</span>
            )}
          </div>
          {/* Basket detail */}
          <div className="border-t border-border/40 pt-1 space-y-0.5">
            {nav.basket_detail.map((b) => (
              <div key={b.ticker} className="flex justify-between text-muted">
                <span>{b.ratio}× {b.ticker}</span>
                <span className="mono">{b.last_price?.toFixed(3) ?? '—'} → {b.component_value.toFixed(3)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Operation controls */}
      <div className="flex gap-2 items-center">
        <div className="flex-1">
          <label className="text-xs text-muted block mb-0.5">Lots</label>
          <input
            type="number" min="1" step="1"
            value={lots}
            onChange={(e) => setLots(Math.max(1, parseInt(e.target.value) || 1))}
            className="input w-full"
          />
        </div>
        <div className="flex flex-col gap-1 mt-4">
          <button
            disabled={loading}
            onClick={() => operate('CREATE')}
            className="btn btn-buy text-xs px-3"
            title={`Give basket → receive ${tc.etf_lot_size * lots} ${tc.ticker}`}
          >
            申购 CREATE
          </button>
          <button
            disabled={loading}
            onClick={() => operate('REDEEM')}
            className="btn btn-sell text-xs px-3"
            title={`Give ${tc.etf_lot_size * lots} ${tc.ticker} → receive basket`}
          >
            赎回 REDEEM
          </button>
        </div>
      </div>

      {tc.etf_fee > 0 && (
        <div className="text-xs text-muted flex justify-between">
          <span>Fee per operation</span>
          <span className="text-sell mono">-{tc.etf_fee.toFixed(2)}</span>
        </div>
      )}

      {msg && (
        <div className={`text-xs rounded px-2 py-1 ${msg.ok ? 'text-buy bg-buy/10' : 'text-sell bg-sell/10'}`}>
          {msg.text}
        </div>
      )}
    </div>
  )
}
