import { format } from 'date-fns'
import type { Trade } from '../api'

interface Props {
  trades: Trade[]
}

export function TradeBlotter({ trades }: Props) {
  return (
    <div className="panel flex flex-col h-full overflow-hidden">
      <div className="panel-header">Recent Trades</div>
      <div className="flex-1 overflow-y-auto">
        {trades.length === 0 ? (
          <div className="p-4 text-center text-muted text-xs">No trades yet</div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-panel">
              <tr className="text-muted text-left">
                <th className="px-3 py-1 font-normal">Time</th>
                <th className="px-3 py-1 font-normal">Ticker</th>
                <th className="px-3 py-1 font-normal text-right">Price</th>
                <th className="px-3 py-1 font-normal text-right">Qty</th>
                <th className="px-3 py-1 font-normal text-right">Side</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((t, i) => (
                <tr key={i} className="border-t border-border/40 hover:bg-border/30">
                  <td className="px-3 py-0.5 text-muted mono">
                    {format(new Date(t.executed_at), 'HH:mm:ss')}
                  </td>
                  <td className="px-3 py-0.5 mono">{t.ticker}</td>
                  <td className={`px-3 py-0.5 mono text-right ${t.aggressor_side === 'BUY' ? 'text-buy' : 'text-sell'}`}>
                    {t.price.toFixed(2)}
                  </td>
                  <td className="px-3 py-0.5 mono text-right">{t.quantity}</td>
                  <td className={`px-3 py-0.5 text-right ${t.aggressor_side === 'BUY' ? 'tag-buy' : 'tag-sell'}`}>
                    {t.aggressor_side}
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
