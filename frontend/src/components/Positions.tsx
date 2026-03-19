import type { Position } from '../api'

interface Props {
  positions: Position[]
}

export function Positions({ positions }: Props) {
  const totalPnl = positions.reduce((s, p) => s + p.total_pnl, 0)
  const realizedPnl = positions.reduce((s, p) => s + p.realized_pnl, 0)

  return (
    <div className="panel flex flex-col h-full overflow-hidden">
      <div className="panel-header flex items-center justify-between">
        <span>Positions & PnL</span>
        <span className={`mono text-sm font-semibold ${totalPnl >= 0 ? 'text-buy' : 'text-sell'}`}>
          {totalPnl >= 0 ? '+' : ''}{totalPnl.toFixed(2)}
        </span>
      </div>

      {positions.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-muted text-xs">
          No open positions
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-panel">
              <tr className="text-muted text-left">
                <th className="px-3 py-1 font-normal">Ticker</th>
                <th className="px-3 py-1 font-normal text-right">Qty</th>
                <th className="px-3 py-1 font-normal text-right">Avg Cost</th>
                <th className="px-3 py-1 font-normal text-right">Settle</th>
                <th className="px-3 py-1 font-normal text-right">Realized</th>
                <th className="px-3 py-1 font-normal text-right">Unrealized</th>
                <th className="px-3 py-1 font-normal text-right">Fees</th>
                <th className="px-3 py-1 font-normal text-right">Total PnL</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((p) => (
                <tr key={p.ticker} className="border-t border-border/40">
                  <td className="px-3 py-1 mono font-semibold">{p.ticker}</td>
                  <td className={`px-3 py-1 mono text-right ${p.quantity > 0 ? 'text-buy' : p.quantity < 0 ? 'text-sell' : 'text-muted'}`}>
                    {p.quantity > 0 ? '+' : ''}{p.quantity}
                  </td>
                  <td className="px-3 py-1 mono text-right text-gray-300">
                    {p.avg_cost.toFixed(2)}
                  </td>
                  <td className="px-3 py-1 mono text-right text-accent">
                    {p.settlement_price != null ? p.settlement_price.toFixed(2) : '—'}
                  </td>
                  <td className={`px-3 py-1 mono text-right ${p.realized_pnl >= 0 ? 'text-buy' : 'text-sell'}`}>
                    {p.realized_pnl >= 0 ? '+' : ''}{p.realized_pnl.toFixed(2)}
                  </td>
                  <td className={`px-3 py-1 mono text-right ${p.unrealized_pnl >= 0 ? 'text-buy' : 'text-sell'}`}>
                    {p.unrealized_pnl >= 0 ? '+' : ''}{p.unrealized_pnl.toFixed(2)}
                  </td>
                  <td className="px-3 py-1 mono text-right text-sell">
                    {p.fees_paid ? `-${p.fees_paid.toFixed(2)}` : '—'}
                  </td>
                  <td className={`px-3 py-1 mono text-right font-semibold ${p.total_pnl >= 0 ? 'text-buy' : 'text-sell'}`}>
                    {p.total_pnl >= 0 ? '+' : ''}{p.total_pnl.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="border-t border-border px-3 py-2 flex justify-end gap-6 text-xs">
            <span className="text-muted">Realized: <span className={`mono font-semibold ${realizedPnl >= 0 ? 'text-buy' : 'text-sell'}`}>{realizedPnl >= 0 ? '+' : ''}{realizedPnl.toFixed(2)}</span></span>
            <span className="text-muted">Total PnL: <span className={`mono font-semibold ${totalPnl >= 0 ? 'text-buy' : 'text-sell'}`}>{totalPnl >= 0 ? '+' : ''}{totalPnl.toFixed(2)}</span></span>
          </div>
        </div>
      )}
    </div>
  )
}
