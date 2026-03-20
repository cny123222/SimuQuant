import { useMemo } from 'react'
import type { OrderBookSnapshot } from '../api'

interface Props {
  snapshot: OrderBookSnapshot | undefined
  ticker: string
}

export function OrderBook({ snapshot, ticker }: Props) {
  const maxQty = useMemo(() => {
    if (!snapshot) return 1
    const all = [...snapshot.bids, ...snapshot.asks].map((l) => l.quantity)
    return Math.max(...all, 1)
  }, [snapshot])

  if (!snapshot) {
    return (
      <div className="panel flex flex-col h-full">
        <div className="panel-header">{ticker} · Order Book</div>
        <div className="flex-1 flex items-center justify-center text-muted text-xs">
          Waiting for data…
        </div>
      </div>
    )
  }

  const { bids, asks, last_price, fair_value } = snapshot

  return (
    <div className="panel flex flex-col h-full overflow-hidden">
      <div className="panel-header flex items-center justify-between">
        <span>{ticker} · Order Book</span>
        {fair_value != null && (
          <span className="text-muted font-mono text-xs">FV {fair_value.toFixed(2)}</span>
        )}
      </div>

      {/* Asks – shown top to bottom, worst ask first */}
      <div className="flex-1 overflow-y-auto flex flex-col-reverse">
        {asks.slice(0, 15).reverse().map((level, i) => (
          <div key={i} className="relative flex items-center px-3 py-0.5 group">
            <div
              className="absolute inset-y-0 right-0 bg-sell/10"
              style={{ width: `${(level.quantity / maxQty) * 100}%` }}
            />
            <span className="text-sell mono text-xs w-20 text-right z-10">
              {level.price.toFixed(2)}
            </span>
            <span className="mono text-xs text-gray-400 ml-auto z-10">
              {level.quantity.toLocaleString()}
            </span>
          </div>
        ))}
      </div>

      {/* Spread / last price */}
      <div className="px-3 py-1 border-y border-border flex items-center justify-between">
        <span className="mono text-sm font-semibold text-white">
          {last_price != null ? last_price.toFixed(2) : '—'}
        </span>
        {bids[0] && asks[0] && (
          <span className="text-muted text-xs mono">
            spread {(asks[0].price - bids[0].price).toFixed(2)}
          </span>
        )}
      </div>

      {/* Bids */}
      <div className="flex-1 overflow-y-auto">
        {bids.slice(0, 15).map((level, i) => (
          <div key={i} className="relative flex items-center px-3 py-0.5">
            <div
              className="absolute inset-y-0 right-0 bg-buy/10"
              style={{ width: `${(level.quantity / maxQty) * 100}%` }}
            />
            <span className="text-buy mono text-xs w-20 text-right z-10">
              {level.price.toFixed(2)}
            </span>
            <span className="mono text-xs text-gray-400 ml-auto z-10">
              {level.quantity.toLocaleString()}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
