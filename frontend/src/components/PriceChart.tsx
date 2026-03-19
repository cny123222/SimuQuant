import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
} from 'recharts'
import type { PricePoint } from '../api'
import { format } from 'date-fns'

interface Props {
  data: PricePoint[]
  ticker: string
  fairValue?: number
}

const CustomTooltip = ({ active, payload }: { active?: boolean; payload?: { value: number; payload: PricePoint }[] }) => {
  if (!active || !payload?.length) return null
  const { value, payload: p } = payload[0]
  return (
    <div className="bg-panel border border-border rounded px-2 py-1 text-xs mono">
      <div className="text-gray-400">{format(new Date(p.timestamp), 'HH:mm:ss')}</div>
      <div className="text-white font-semibold">{value.toFixed(2)}</div>
    </div>
  )
}

export function PriceChart({ data, ticker, fairValue }: Props) {
  const prices = data.map((d) => d.price)
  const min = prices.length ? Math.min(...prices) * 0.999 : 0
  const max = prices.length ? Math.max(...prices) * 1.001 : 200

  const first = data[0]?.price ?? 0
  const last = data[data.length - 1]?.price ?? 0
  const up = last >= first

  return (
    <div className="panel flex flex-col h-full">
      <div className="panel-header flex items-center justify-between">
        <span>{ticker} · Price</span>
        <span className={`mono text-sm font-semibold ${up ? 'text-buy' : 'text-sell'}`}>
          {last ? last.toFixed(2) : '—'}
          {first ? (
            <span className="text-xs ml-2">
              {up ? '+' : ''}{((last - first) / first * 100).toFixed(2)}%
            </span>
          ) : null}
        </span>
      </div>
      <div className="flex-1 p-2">
        {data.length < 2 ? (
          <div className="h-full flex items-center justify-center text-muted text-xs">
            Waiting for data…
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={`grad-${ticker}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={up ? '#3fb950' : '#f85149'} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={up ? '#3fb950' : '#f85149'} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="timestamp"
                tickFormatter={(v) => format(new Date(v), 'HH:mm:ss')}
                tick={{ fontSize: 10, fill: '#8b949e' }}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                domain={[min, max]}
                tick={{ fontSize: 10, fill: '#8b949e', fontFamily: 'JetBrains Mono' }}
                tickLine={false}
                axisLine={false}
                width={52}
                tickFormatter={(v) => v.toFixed(1)}
              />
              <Tooltip content={<CustomTooltip />} />
              {fairValue != null && (
                <ReferenceLine
                  y={fairValue}
                  stroke="#58a6ff"
                  strokeDasharray="3 3"
                  label={{ value: 'FV', fill: '#58a6ff', fontSize: 10 }}
                />
              )}
              <Area
                type="monotone"
                dataKey="price"
                stroke={up ? '#3fb950' : '#f85149'}
                strokeWidth={1.5}
                fill={`url(#grad-${ticker})`}
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
