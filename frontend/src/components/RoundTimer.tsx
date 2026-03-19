import { useEffect, useState } from 'react'
import { useMarketStore } from '../store/marketStore'

export function RoundTimer() {
  const round = useMarketStore((s) => s.round)
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (!round || round.status !== 'ACTIVE') return
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - round.startedAt) / 1000))
    }, 500)
    return () => clearInterval(id)
  }, [round])

  if (!round) return null

  const remaining = Math.max(0, round.durationSeconds - elapsed)
  const pct = round.durationSeconds > 0 ? (remaining / round.durationSeconds) * 100 : 0
  const color = remaining < 30 ? 'bg-sell' : remaining < 60 ? 'bg-yellow-500' : 'bg-buy'

  const mm = String(Math.floor(remaining / 60)).padStart(2, '0')
  const ss = String(remaining % 60).padStart(2, '0')

  if (round.status === 'FINISHED') {
    return (
      <div className="flex items-center gap-2 text-xs text-muted">
        <span className="w-2 h-2 rounded-full bg-border inline-block" />
        Round Finished
      </div>
    )
  }

  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full bg-buy animate-pulse inline-block" />
        <span className="text-xs text-muted">LIVE</span>
      </div>
      <div className={`mono font-semibold text-sm ${remaining < 30 ? 'text-sell' : 'text-white'}`}>
        {mm}:{ss}
      </div>
      <div className="w-24 h-1.5 bg-border rounded-full overflow-hidden">
        <div
          className={`h-full ${color} transition-all duration-500`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
