import { useState } from 'react'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  Legend,
} from 'recharts'
import type { PricePoint } from '../api'
import { format } from 'date-fns'

const COLORS = ['#3fb950', '#58a6ff', '#f0883e', '#bc8cff', '#f85149', '#56d4dd', '#e3b341']
const TIME_WINDOW_MS = 75_000
const MAX_VISIBLE_POINTS = 200

interface Props {
  allPriceHistory: Record<string, PricePoint[]>
  tickers: string[]
  activeTicker: string
  fairValues?: Record<string, number | undefined>
}

function roundTs(ts: string): number {
  return Math.round(new Date(ts).getTime() / 500) * 500
}

function mergeTimelines(
  allData: Record<string, PricePoint[]>,
  visible: string[],
): Record<string, number | null>[] {
  const buckets = new Map<number, Record<string, number | null>>()

  for (const ticker of visible) {
    for (const p of allData[ticker] ?? []) {
      const key = roundTs(p.timestamp)
      if (!buckets.has(key)) {
        const row: Record<string, number | null> = { _ts: key }
        for (const t of visible) row[t] = null
        buckets.set(key, row)
      }
      buckets.get(key)![ticker] = p.price
    }
  }

  const rows = Array.from(buckets.values()).sort(
    (a, b) => (a._ts as number) - (b._ts as number),
  )

  return rows.slice(-MAX_VISIBLE_POINTS)
}

function tickerColor(ticker: string, allTickers: string[]): string {
  const idx = allTickers.indexOf(ticker)
  return COLORS[(idx === -1 ? 0 : idx) % COLORS.length]
}

export function PriceChart({ allPriceHistory, tickers, activeTicker, fairValues }: Props) {
  const [overlays, setOverlays] = useState<Set<string>>(new Set(tickers))

  const visible = tickers.filter((t) => overlays.has(t))
  const merged = mergeTimelines(allPriceHistory, visible)

  const now = merged.length > 0 ? (merged[merged.length - 1]._ts as number) : Date.now()
  const xMin = now - TIME_WINDOW_MS
  const xMax = now
  const windowData = merged.filter((r) => (r._ts as number) >= xMin)

  let min = Infinity, max = -Infinity
  for (const row of windowData) {
    for (const t of visible) {
      const v = row[t] as number | null
      if (v != null) {
        if (v < min) min = v
        if (v > max) max = v
      }
    }
  }
  if (!isFinite(min)) { min = 0; max = 200 }
  const pad = (max - min) * 0.02 || 1
  min = min - pad
  max = max + pad

  const activeData = allPriceHistory[activeTicker] ?? []
  const first = activeData[0]?.price ?? 0
  const last = activeData[activeData.length - 1]?.price ?? 0
  const up = last >= first

  function toggleTicker(t: string) {
    setOverlays((prev) => {
      const next = new Set(prev)
      if (next.has(t) && next.size > 1) next.delete(t)
      else next.add(t)
      return next
    })
  }

  return (
    <div className="panel flex flex-col h-full">
      <div className="panel-header flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span>Price</span>
          {tickers.length > 1 && (
            <div className="flex gap-1 ml-1">
              {tickers.map((t, i) => (
                <button
                  key={t}
                  onClick={() => toggleTicker(t)}
                  className="px-1.5 py-0 rounded text-xs border transition-colors"
                  style={{
                    borderColor: overlays.has(t) ? COLORS[i % COLORS.length] : 'var(--border)',
                    color: overlays.has(t) ? COLORS[i % COLORS.length] : 'var(--muted)',
                    background: overlays.has(t) ? `${COLORS[i % COLORS.length]}15` : 'transparent',
                  }}
                >
                  {t}
                </button>
              ))}
            </div>
          )}
        </div>
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
        {windowData.length < 2 ? (
          <div className="h-full flex items-center justify-center text-muted text-xs">
            Waiting for data…
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={windowData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <XAxis
                dataKey="_ts"
                type="number"
                domain={[xMin, xMax]}
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
                tickFormatter={(v: number) => v.toFixed(1)}
              />
              <Tooltip
                labelFormatter={(v) => format(new Date(v as number), 'HH:mm:ss')}
                contentStyle={{
                  background: '#161b22',
                  border: '1px solid #30363d',
                  borderRadius: 4,
                  fontSize: 11,
                  fontFamily: 'JetBrains Mono',
                }}
                itemStyle={{ padding: 0 }}
                formatter={(value: number) => value?.toFixed(2) ?? '—'}
              />
              {visible.length > 1 && (
                <Legend
                  wrapperStyle={{ fontSize: 10, paddingTop: 2 }}
                  iconSize={8}
                />
              )}
              {fairValues && visible.length === 1 && fairValues[visible[0]] != null && (
                <ReferenceLine
                  y={fairValues[visible[0]]}
                  stroke="#58a6ff"
                  strokeDasharray="3 3"
                  label={{ value: 'FV', fill: '#58a6ff', fontSize: 10 }}
                />
              )}
              {visible.map((t) => (
                <Line
                  key={t}
                  type="monotone"
                  dataKey={t}
                  name={t}
                  stroke={tickerColor(t, tickers)}
                  strokeWidth={t === activeTicker ? 2 : 1.5}
                  dot={false}
                  isAnimationActive={false}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
