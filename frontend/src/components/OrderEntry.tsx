import { useState } from 'react'
import { api } from '../api'
import { useMarketStore } from '../store/marketStore'

interface Props {
  roundId: number
  tickers: string[]
  onOrderPlaced?: () => void
}

export function OrderEntry({ roundId, tickers, onOrderPlaced }: Props) {
  const orderBooks = useMarketStore((s) => s.orderBooks)

  const [ticker, setTicker] = useState(tickers[0] ?? '')
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY')
  const [orderType, setOrderType] = useState<'LIMIT' | 'MARKET'>('LIMIT')
  const [price, setPrice] = useState('')
  const [qty, setQty] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const book = orderBooks[ticker]
  const suggestBid = book?.bids[0]?.price
  const suggestAsk = book?.asks[0]?.price

  async function submit() {
    setError('')
    const q = parseInt(qty)
    if (isNaN(q) || q <= 0) { setError('Invalid quantity'); return }
    if (orderType === 'LIMIT' && !price) { setError('Price required for limit orders'); return }

    setLoading(true)
    try {
      await api.placeOrder(roundId, {
        ticker,
        side,
        order_type: orderType,
        price: orderType === 'LIMIT' ? parseFloat(price) : undefined,
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
        {/* Ticker */}
        <div className="flex gap-2">
          <select
            value={ticker}
            onChange={(e) => setTicker(e.target.value)}
            className="input flex-1"
          >
            {tickers.map((t) => <option key={t}>{t}</option>)}
          </select>

          {/* Side toggle */}
          <button
            onClick={() => setSide('BUY')}
            className={`btn flex-1 ${side === 'BUY' ? 'btn-buy' : 'btn-ghost'}`}
          >
            BUY
          </button>
          <button
            onClick={() => setSide('SELL')}
            className={`btn flex-1 ${side === 'SELL' ? 'btn-sell' : 'btn-ghost'}`}
          >
            SELL
          </button>
        </div>

        {/* Order type */}
        <div className="flex gap-2">
          {(['LIMIT', 'MARKET'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setOrderType(t)}
              className={`btn flex-1 text-xs ${orderType === t ? 'btn-primary' : 'btn-ghost'}`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Price */}
        {orderType === 'LIMIT' && (
          <div>
            <label className="text-xs text-muted mb-1 block">Price</label>
            <div className="flex gap-1">
              <input
                type="number"
                step="0.01"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="0.00"
                className="input flex-1"
              />
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
          <label className="text-xs text-muted mb-1 block">Quantity</label>
          <input
            type="number"
            min="1"
            step="1"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            placeholder="10"
            className="input"
          />
        </div>

        {error && <div className="text-sell text-xs">{error}</div>}

        <button
          disabled={loading}
          onClick={submit}
          className={`w-full btn ${side === 'BUY' ? 'btn-buy' : 'btn-sell'}`}
        >
          {loading ? 'Placing…' : `${side} ${ticker}`}
        </button>
      </div>
    </div>
  )
}
