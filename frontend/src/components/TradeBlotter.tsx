import { format } from 'date-fns'
import type { Trade } from '../api'

interface Props {
  trades: Trade[]
  /** Optional: only show trades for this ticker. Omit to show all. */
  filterTicker?: string
}

function isRobot(label: string) {
  return label.startsWith('Robot-')
}

function LabelCell({ label }: { label: string }) {
  if (!label || label === '-') {
    return <span className="text-muted">—</span>
  }
  if (isRobot(label)) {
    // e.g. "Robot-MM-1" → display in orange
    return <span className="text-orange-400 mono">{label}</span>
  }
  return <span className="text-white mono">{label}</span>
}

export function TradeBlotter({ trades, filterTicker }: Props) {
  const shown = filterTicker
    ? trades.filter((t) => t.ticker === filterTicker)
    : trades

  return (
    <div className="panel flex flex-col h-full overflow-hidden">
      <div className="panel-header flex items-center justify-between">
        <span>Recent Trades</span>
        {filterTicker && <span className="text-accent text-xs">{filterTicker}</span>}
      </div>
      <div className="flex-1 overflow-y-auto">
        {shown.length === 0 ? (
          <div className="p-4 text-center text-muted text-xs">No trades yet</div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-panel">
              <tr className="text-muted text-left border-b border-border/40">
                <th className="px-2 py-1 font-normal">Time</th>
                <th className="px-2 py-1 font-normal">Ticker</th>
                <th className="px-2 py-1 font-normal text-right">Price</th>
                <th className="px-2 py-1 font-normal text-right">Qty</th>
                <th className="px-2 py-1 font-normal">Buyer</th>
                <th className="px-2 py-1 font-normal">Seller</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((t, i) => (
                <tr key={i} className="border-t border-border/40 hover:bg-border/20">
                  <td className="px-2 py-0.5 text-muted mono whitespace-nowrap">
                    {format(new Date(t.executed_at), 'HH:mm:ss')}
                  </td>
                  <td className="px-2 py-0.5 mono text-muted">{t.ticker}</td>
                  <td className={`px-2 py-0.5 mono text-right font-medium ${t.aggressor_side === 'BUY' ? 'text-buy' : 'text-sell'}`}>
                    {t.price.toFixed(2)}
                  </td>
                  <td className="px-2 py-0.5 mono text-right text-white">{t.quantity}</td>
                  <td className="px-2 py-0.5">
                    <LabelCell label={t.buyer_label ?? '-'} />
                  </td>
                  <td className="px-2 py-0.5">
                    <LabelCell label={t.seller_label ?? '-'} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
