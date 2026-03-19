import { useState } from 'react'
import { api, type Order } from '../api'

interface Props {
  roundId: number
  orders: Order[]
  onCancel?: () => void
}

export function MyOrders({ roundId, orders, onCancel }: Props) {
  const [cancelling, setCancelling] = useState<number | null>(null)

  async function cancelOrder(id: number) {
    setCancelling(id)
    try {
      await api.cancelOrder(roundId, id)
      onCancel?.()
    } catch {
      // ignore
    } finally {
      setCancelling(null)
    }
  }

  const open = orders.filter((o) => o.status === 'OPEN' || o.status === 'PARTIAL')

  return (
    <div className="panel flex flex-col h-full overflow-hidden">
      <div className="panel-header flex items-center justify-between">
        <span>My Orders</span>
        <span className="text-muted text-xs">{open.length} open</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {orders.length === 0 ? (
          <div className="p-4 text-center text-muted text-xs">No orders yet</div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-panel">
              <tr className="text-muted text-left">
                <th className="px-3 py-1 font-normal">Ticker</th>
                <th className="px-3 py-1 font-normal">Type</th>
                <th className="px-3 py-1 font-normal text-right">Price</th>
                <th className="px-3 py-1 font-normal text-right">Qty</th>
                <th className="px-3 py-1 font-normal text-right">Filled</th>
                <th className="px-3 py-1 font-normal text-center">Status</th>
                <th className="px-3 py-1 font-normal" />
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="border-t border-border/40">
                  <td className={`px-3 py-1 mono font-semibold ${o.side === 'BUY' ? 'text-buy' : 'text-sell'}`}>
                    {o.ticker}
                  </td>
                  <td className="px-3 py-1 text-muted">{o.order_type}</td>
                  <td className="px-3 py-1 mono text-right">
                    {o.price != null ? o.price.toFixed(2) : 'MKT'}
                  </td>
                  <td className="px-3 py-1 mono text-right">{o.quantity}</td>
                  <td className="px-3 py-1 mono text-right">{o.filled_quantity}</td>
                  <td className="px-3 py-1 text-center">
                    <StatusBadge status={o.status} />
                  </td>
                  <td className="px-3 py-1">
                    {(o.status === 'OPEN' || o.status === 'PARTIAL') && (
                      <button
                        onClick={() => cancelOrder(o.id)}
                        disabled={cancelling === o.id}
                        className="text-muted hover:text-sell text-xs"
                      >
                        ✕
                      </button>
                    )}
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

function StatusBadge({ status }: { status: Order['status'] }) {
  const map: Record<Order['status'], string> = {
    OPEN: 'text-accent',
    PARTIAL: 'text-yellow-400',
    FILLED: 'text-buy',
    CANCELLED: 'text-muted line-through',
  }
  return <span className={`text-xs mono ${map[status]}`}>{status}</span>
}
