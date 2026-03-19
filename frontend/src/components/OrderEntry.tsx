import { useState } from 'react'
import { api, type Round } from '../api'
import { useMarketStore } from '../store/marketStore'

interface Props {
  roundId: number
  round: Round
  onOrderPlaced?: () => void
}

export function OrderEntry({ roundId, round, onOrderPlaced }: Props) {
  const orderBooks = useMarketStore((s) => s.orderBooks)
  const tickers = round.tickers_config.map((tc) => tc.ticker)

  const [ticker, setTicker] = useState(tickers[0] ?? '')
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY')
  const [orderType, setOrderType] = useState<'LIMIT' | 'MARKET' | 'IOC'>('LIMIT')
  const [price, setPrice] = useState('')
  const [qty, setQty] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const book = orderBooks[ticker]
  const suggestBid = book?.bids[0]?.price
  const suggestAsk = book?.asks[0]?.price
  const tickerCfg = round.tickers_config.find((tc) => tc.ticker === ticker)
  const settlementPrice = tickerCfg?.settlement_price

  // Per-ticker effective rules (fall back to round-level)
  const allowedOrderTypes: string[] = tickerCfg?.allowed_order_types?.length
    ? tickerCfg.allowed_order_types
    : ['LIMIT', 'MARKET', 'IOC']
  const effectiveMaxQty = tickerCfg?.max_order_quantity ?? (round.max_order_quantity > 0 ? round.max_order_quantity : 0)
  const effectiveRateLimit = tickerCfg?.max_orders_per_second ?? (round.max_orders_per_second > 0 ? round.max_orders_per_second : 0)
  const correlRef = tickerCfg?.price_ref_ticker
  const correlMult = tickerCfg?.price_multiplier ?? 1.0

  const needsPrice = orderType === 'LIMIT' || orderType === 'IOC'

  async function submit() {
    setError('')
    const q = parseInt(qty)
    if (isNaN(q) || q <= 0) { setError('Invalid quantity'); return }
    if (effectiveMaxQty > 0 && q > effectiveMaxQty) {
      setError(`Max quantity is ${effectiveMaxQty}`); return
    }
    if (!allowedOrderTypes.includes(orderType)) {
      setError(`${orderType} not allowed for ${ticker}. Allowed: ${allowedOrderTypes.join(', ')}`); return
    }
    if (needsPrice && !price) { setError('Price required'); return }

    setLoading(true)
    try {
      await api.placeOrder(roundId, {
        ticker,
        side,
        order_type: orderType,
        price: needsPrice ? parseFloat(price) : undefined,
        quantity: q,
      })
      setQty('')
      onOrderPlaced?.()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="panel">
      <div className="panel-header">Order Entry</div>
      <div className="p-3 space-y-2">

        {/* Rules info bar */}
        {(round.order_fee > 0 || effectiveMaxQty > 0 || effectiveRateLimit > 0 || settlementPrice != null || correlRef || allowedOrderTypes.length < 3) && (
          <div className="bg-surface rounded p-2 text-xs text-muted space-y-0.5 border border-border/60">
            {allowedOrderTypes.length < 3 && (
              <div className="flex justify-between">
                <span>Order types</span>
                <span className="mono text-accent">{allowedOrderTypes.join(', ')}</span>
              </div>
            )}
            {round.order_fee > 0 && (
              <div className="flex justify-between">
                <span>Order fee</span>
                <span className="text-sell mono">{round.order_fee.toFixed(2)}/order</span>
              </div>
            )}
            {effectiveMaxQty > 0 && (
              <div className="flex justify-between">
                <span>Max qty</span>
                <span className="mono text-yellow-400">{effectiveMaxQty}</span>
              </div>
            )}
            {effectiveRateLimit > 0 && (
              <div className="flex justify-between">
                <span>Rate limit</span>
                <span className="mono text-yellow-400">{effectiveRateLimit}/s</span>
              </div>
            )}
            {settlementPrice != null && (
              <div className="flex justify-between">
                <span>Settlement</span>
                <span className="mono text-accent">{settlementPrice.toFixed(2)}</span>
              </div>
            )}
            {correlRef && (
              <div className="flex justify-between">
                <span>Fair value</span>
                <span className="mono text-accent">{correlMult}× {correlRef}</span>
              </div>
            )}
          </div>
        )}

        {/* Ticker */}
        <div className="flex gap-2">
          <select
            value={ticker}
            onChange={(e) => setTicker(e.target.value)}
            className="input flex-1"
          >
            {tickers.map((t) => <option key={t}>{t}</option>)}
          </select>
          <button onClick={() => setSide('BUY')}
            className={`btn flex-1 ${side === 'BUY' ? 'btn-buy' : 'btn-ghost'}`}>BUY</button>
          <button onClick={() => setSide('SELL')}
            className={`btn flex-1 ${side === 'SELL' ? 'btn-sell' : 'btn-ghost'}`}>SELL</button>
        </div>

        {/* Order type - only show allowed types */}
        <div className="flex gap-1">
          {(['LIMIT', 'IOC', 'MARKET'] as const).filter((t) => allowedOrderTypes.includes(t)).map((t) => (
            <button key={t} onClick={() => setOrderType(t)}
              className={`btn flex-1 text-xs ${orderType === t ? 'btn-primary' : 'btn-ghost'}`}>
              {t}
            </button>
          ))}
        </div>
        {orderType === 'IOC' && (
          <div className="text-xs text-muted bg-surface rounded px-2 py-1 border border-border/60">
            IOC: fills immediately, remainder cancelled
          </div>
        )}

        {/* Price */}
        {needsPrice && (
          <div>
            <label className="text-xs text-muted mb-1 block">Price</label>
            <div className="flex gap-1">
              <input type="number" step="0.01" value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="0.00" className="input flex-1" />
              {suggestBid != null && (
                <button className="btn-ghost text-xs px-2" onClick={() => setPrice(suggestBid.toFixed(2))}>
                  Bid
                </button>
              )}
              {suggestAsk != null && (
                <button className="btn-ghost text-xs px-2" onClick={() => setPrice(suggestAsk.toFixed(2))}>
                  Ask
                </button>
              )}
            </div>
          </div>
        )}

        {/* Qty */}
        <div>
          <label className="text-xs text-muted mb-1 flex justify-between">
            <span>Quantity</span>
            {effectiveMaxQty > 0 && (
              <span className="text-yellow-400">max {effectiveMaxQty}</span>
            )}
          </label>
          <input type="number" min="1" step="1"
            value={qty} onChange={(e) => setQty(e.target.value)}
            placeholder="10" className="input" />
        </div>

        {/* Fee preview */}
        {round.order_fee > 0 && qty && !isNaN(parseInt(qty)) && (
          <div className="text-xs text-muted flex justify-between">
            <span>Fee charged on submit</span>
            <span className="text-sell mono">-{round.order_fee.toFixed(2)}</span>
          </div>
        )}

        {error && <div className="text-sell text-xs">{error}</div>}

        <button disabled={loading} onClick={submit}
          className={`w-full btn ${side === 'BUY' ? 'btn-buy' : 'btn-sell'}`}>
          {loading ? 'Placing…' : `${orderType} ${side} ${ticker}`}
        </button>
      </div>
    </div>
  )
}
