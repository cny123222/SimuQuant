import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, type Round, type Session } from '../api'
import { useAuthStore } from '../store/authStore'

export function SessionsPage() {
  const { user, logout } = useAuthStore()
  const nav = useNavigate()
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)

  async function load() {
    try {
      setSessions(await api.listSessions())
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <header className="h-12 border-b border-border flex items-center px-6 gap-4 shrink-0">
        <span className="font-bold text-white text-lg">SimuQuant</span>
        <div className="ml-auto flex items-center gap-3">
          {user?.is_admin && (
            <Link to="/admin" className="btn-ghost btn text-xs">Admin</Link>
          )}
          <span className="text-muted text-xs">{user?.username}</span>
          <button onClick={() => { logout(); nav('/login') }} className="btn-ghost btn text-xs">
            Logout
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-lg font-semibold text-white mb-4">Active Sessions</h2>
          {loading ? (
            <div className="text-muted text-sm">Loading…</div>
          ) : sessions.length === 0 ? (
            <div className="panel p-8 text-center text-muted text-sm">
              No sessions yet. Ask an admin to create one.
            </div>
          ) : (
            <div className="space-y-4">
              {sessions.map((s) => (
                <SessionCard key={s.id} session={s} />
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

function SessionCard({ session }: { session: Session }) {
  const [rounds, setRounds] = useState<Round[]>([])
  const [open, setOpen] = useState(false)

  async function toggle() {
    if (!open && rounds.length === 0) {
      setRounds(await api.listRounds(session.id))
    }
    setOpen(!open)
  }

  const statusColor = {
    PENDING: 'text-muted',
    ACTIVE: 'text-buy',
    FINISHED: 'text-accent',
  }[session.status]

  return (
    <div className="panel overflow-hidden">
      <button
        onClick={toggle}
        className="w-full flex items-center px-5 py-4 gap-4 hover:bg-border/20 transition-colors"
      >
        <div className="flex-1 text-left">
          <div className="font-semibold text-white">{session.name}</div>
          <div className="text-xs text-muted mt-0.5">ID #{session.id}</div>
        </div>
        <span className={`text-xs font-medium ${statusColor}`}>{session.status}</span>
        <span className="text-muted text-xs">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="border-t border-border">
          {rounds.length === 0 ? (
            <div className="px-5 py-3 text-muted text-xs">No rounds yet</div>
          ) : (
            rounds.map((r) => <RoundRow key={r.id} round={r} />)
          )}
        </div>
      )}
    </div>
  )
}

function RoundRow({ round }: { round: Round }) {
  const tickers = round.tickers_config.map((tc) => tc.ticker).join(', ')
  const statusColor = {
    PENDING: 'text-muted',
    ACTIVE: 'text-buy',
    FINISHED: 'text-accent',
  }[round.status]

  return (
    <div className="flex items-center px-5 py-3 border-b border-border/40 last:border-0 gap-4">
      <div className="flex-1">
        <span className="text-sm text-white">
          Round {round.round_number}
          {round.name ? ` – ${round.name}` : ''}
        </span>
        <span className="text-xs text-muted ml-2">{tickers}</span>
      </div>
      <span className="text-xs mono text-muted">{round.duration_seconds}s</span>
      <span className={`text-xs font-medium ${statusColor}`}>{round.status}</span>
      {round.status === 'ACTIVE' && (
        <>
          <Link to={`/viewer/${round.id}`} className="btn-ghost btn text-xs">
            Watch
          </Link>
          <Link to={`/trade/${round.id}`} className="btn-primary btn text-xs">
            Trade →
          </Link>
        </>
      )}
      {round.status === 'FINISHED' && (
        <Link to={`/trade/${round.id}`} className="btn-ghost btn text-xs">
          View
        </Link>
      )}
    </div>
  )
}
