import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { api, type Session, type Round, type User, type LeaderboardEntry } from '../api'

export function AdminPage() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [activeTab, setActiveTab] = useState<'sessions' | 'users'>('sessions')

  const load = useCallback(async () => {
    const [ss, us] = await Promise.all([api.listSessions(), api.listUsers()])
    setSessions(ss)
    setUsers(us)
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <header className="h-12 border-b border-border flex items-center px-6 gap-4 shrink-0">
        <Link to="/" className="text-muted hover:text-white text-sm">← Sessions</Link>
        <span className="font-bold text-white">Admin Panel</span>
        <div className="ml-auto flex gap-2">
          {(['sessions', 'users'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              className={`btn text-xs ${activeTab === t ? 'btn-primary' : 'btn-ghost'}`}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-6">
        <div className="max-w-5xl mx-auto space-y-6">
          {activeTab === 'sessions' ? (
            <SessionsAdmin sessions={sessions} onRefresh={load} />
          ) : (
            <UsersAdmin users={users} onRefresh={load} />
          )}
        </div>
      </main>
    </div>
  )
}

// ── Sessions admin ─────────────────────────────────────────────────────────

function SessionsAdmin({ sessions, onRefresh }: { sessions: Session[]; onRefresh: () => void }) {
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [selected, setSelected] = useState<Session | null>(null)

  async function createSession() {
    if (!name.trim()) return
    setCreating(true)
    try {
      await api.createSession(name.trim())
      setName('')
      onRefresh()
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="panel p-4 space-y-3">
        <div className="text-sm font-semibold text-white">Create Session</div>
        <div className="flex gap-2">
          <input
            className="input flex-1"
            placeholder="Session name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && createSession()}
          />
          <button className="btn-primary btn" onClick={createSession} disabled={creating || !name}>
            Create
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {sessions.map((s) => (
          <div key={s.id} className="panel overflow-hidden">
            <button
              onClick={() => setSelected(selected?.id === s.id ? null : s)}
              className="w-full flex items-center px-5 py-3 gap-3 hover:bg-border/20"
            >
              <div className="flex-1 text-left">
                <span className="font-medium text-white">{s.name}</span>
                <span className="text-muted text-xs ml-2">#{s.id}</span>
              </div>
              <StatusBadge status={s.status} />
              <span className="text-muted text-xs">{selected?.id === s.id ? '▲' : '▼'}</span>
            </button>
            {selected?.id === s.id && (
              <div className="border-t border-border">
                <SessionDetail session={s} onRefresh={onRefresh} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function SessionDetail({ session, onRefresh }: { session: Session; onRefresh: () => void }) {
  const [rounds, setRounds] = useState<Round[]>([])
  const [showForm, setShowForm] = useState(false)

  const loadRounds = useCallback(async () => {
    setRounds(await api.listRounds(session.id))
  }, [session.id])

  useEffect(() => { loadRounds() }, [loadRounds])

  async function startRound(r: Round) {
    await api.startRound(session.id, r.id)
    await loadRounds()
    onRefresh()
  }

  async function finishRound(r: Round) {
    await api.finishRound(session.id, r.id)
    await loadRounds()
    onRefresh()
  }

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted font-semibold uppercase tracking-wider">Rounds</span>
        <button className="btn-ghost btn text-xs" onClick={() => setShowForm(!showForm)}>
          + Add Round
        </button>
      </div>

      {showForm && (
        <RoundForm
          sessionId={session.id}
          nextNumber={(rounds[rounds.length - 1]?.round_number ?? 0) + 1}
          onCreated={() => { setShowForm(false); loadRounds() }}
        />
      )}

      {rounds.length === 0 ? (
        <div className="text-muted text-xs">No rounds yet</div>
      ) : (
        rounds.map((r) => (
          <div key={r.id} className="flex items-center gap-3 bg-surface rounded px-3 py-2 text-sm">
            <span className="text-white font-medium">Round {r.round_number}</span>
            {r.name && <span className="text-muted text-xs">– {r.name}</span>}
            <span className="text-muted text-xs mono">{r.tickers_config.map((t) => t.ticker).join(', ')}</span>
            <span className="text-muted text-xs">{r.duration_seconds}s</span>
            <div className="ml-auto flex gap-2 items-center">
              <StatusBadge status={r.status} />
              {r.status === 'PENDING' && (
                <button className="btn-buy btn text-xs" onClick={() => startRound(r)}>Start</button>
              )}
              {r.status === 'ACTIVE' && (
                <>
                  <Link to={`/trade/${r.id}`} className="btn-primary btn text-xs">View Live</Link>
                  <button className="btn-sell btn text-xs" onClick={() => finishRound(r)}>Finish</button>
                  <LeaderboardButton roundId={r.id} />
                </>
              )}
              {r.status === 'FINISHED' && (
                <Link to={`/trade/${r.id}`} className="btn-ghost btn text-xs">View</Link>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  )
}

function LeaderboardButton({ roundId }: { roundId: number }) {
  const [show, setShow] = useState(false)
  const [entries, setEntries] = useState<LeaderboardEntry[]>([])

  async function toggle() {
    if (!show) setEntries(await api.getLeaderboard(roundId))
    setShow(!show)
  }

  return (
    <div className="relative">
      <button className="btn-ghost btn text-xs" onClick={toggle}>Leaderboard</button>
      {show && (
        <div className="absolute right-0 top-8 z-50 w-72 panel shadow-xl">
          <div className="panel-header">Leaderboard</div>
          {entries.length === 0 ? (
            <div className="p-3 text-muted text-xs">No entries</div>
          ) : (
            entries.map((e) => (
              <div key={e.username} className="flex items-center px-3 py-2 border-t border-border/40 text-xs gap-2">
                <span className="text-muted w-4">#{e.rank}</span>
                <span className="flex-1 text-white">{e.username}</span>
                <span className={`mono font-semibold ${e.total_pnl >= 0 ? 'text-buy' : 'text-sell'}`}>
                  {e.total_pnl >= 0 ? '+' : ''}{e.total_pnl.toFixed(2)}
                </span>
              </div>
            ))
          )}
          <button className="w-full text-xs text-muted py-2 hover:text-white border-t border-border/40" onClick={() => setShow(false)}>close</button>
        </div>
      )}
    </div>
  )
}

// ── Round create form ──────────────────────────────────────────────────────

type ETFBasketDraft = { ticker: string; ratio: number }

type TickerDraft = {
  ticker: string
  initial_price: number
  volatility: number
  drift: number
  jump_intensity: number
  jump_size: number
  settlement_price: number | null
  // per-ticker rules
  allowed_order_types: string[]
  max_orders_per_second: number | null
  max_order_quantity: number | null
  // correlation
  price_ref_ticker: string | null
  price_multiplier: number
  residual_volatility: number
  // ETF
  is_etf: boolean
  etf_lot_size: number
  etf_basket: ETFBasketDraft[]
  etf_fee: number
}

function makeTicker(ticker: string, init_price = 100): TickerDraft {
  return {
    ticker,
    initial_price: init_price,
    volatility: 0.02,
    drift: 0,
    jump_intensity: 0.01,
    jump_size: 0.05,
    settlement_price: null,
    allowed_order_types: [],
    max_orders_per_second: null,
    max_order_quantity: null,
    price_ref_ticker: null,
    price_multiplier: 1.0,
    residual_volatility: 0.005,
    is_etf: false,
    etf_lot_size: 10,
    etf_basket: [],
    etf_fee: 0,
  }
}

const DEFAULT_TICKERS: TickerDraft[] = [makeTicker('AAPL', 150)]

const ALL_ORDER_TYPES = ['LIMIT', 'MARKET', 'IOC']

function TickerRow({
  t,
  i,
  tickers,
  onChange,
  onRemove,
}: {
  t: TickerDraft
  i: number
  tickers: TickerDraft[]
  onChange: (field: string, value: unknown) => void
  onRemove: () => void
}) {
  const [expanded, setExpanded] = useState(false)

  function toggleOrderType(ot: string) {
    const cur = t.allowed_order_types
    const next = cur.includes(ot) ? cur.filter((x) => x !== ot) : [...cur, ot]
    onChange('allowed_order_types', next)
  }

  const otherTickers = tickers.filter((_, idx) => idx !== i).map((x) => x.ticker)

  return (
    <div className="border border-border rounded mb-1 overflow-hidden">
      {/* main row */}
      <div className="grid grid-cols-8 gap-1 p-1 items-center">
        <input className="input" value={t.ticker} onChange={(e) => onChange('ticker', e.target.value.toUpperCase())} placeholder="Ticker" />
        <input className="input" type="number" value={t.initial_price} onChange={(e) => onChange('initial_price', +e.target.value)} placeholder="Init $" />
        <input className="input" type="number" step="0.001" value={t.volatility} onChange={(e) => onChange('volatility', +e.target.value)} placeholder="σ" />
        <input className="input" type="number" step="0.001" value={t.drift} onChange={(e) => onChange('drift', +e.target.value)} placeholder="μ" />
        <input className="input" type="number" step="0.01" value={t.jump_intensity} onChange={(e) => onChange('jump_intensity', +e.target.value)} placeholder="λ" />
        <input className="input" type="number" step="0.01"
          value={t.settlement_price ?? ''}
          onChange={(e) => onChange('settlement_price', e.target.value === '' ? null : +e.target.value)}
          placeholder="Settle $" />
        <button
          className={`text-xs px-1 rounded border ${expanded ? 'border-accent text-accent' : 'border-border text-muted'} hover:border-accent hover:text-accent`}
          onClick={() => setExpanded(!expanded)}
          title="Per-ticker rules & correlation"
        >
          Rules
        </button>
        <button className="text-sell hover:text-red-400 text-sm text-center" onClick={onRemove}>✕</button>
      </div>

      {/* expanded per-ticker rules */}
      {expanded && (
        <div className="border-t border-border bg-surface/60 p-2 space-y-2 text-xs">
          <div className="grid grid-cols-3 gap-2">
            <div>
              <div className="text-muted mb-1">Allowed Order Types <span className="text-muted font-normal">(empty = all)</span></div>
              <div className="flex gap-1">
                {ALL_ORDER_TYPES.map((ot) => (
                  <button
                    key={ot}
                    onClick={() => toggleOrderType(ot)}
                    className={`px-2 py-0.5 rounded text-xs border ${
                      t.allowed_order_types.includes(ot)
                        ? 'border-accent text-accent bg-accent/10'
                        : 'border-border text-muted'
                    }`}
                  >
                    {ot}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="text-muted mb-1">Max Qty / Order <span className="text-muted">(null = round default)</span></div>
              <input
                className="input w-full"
                type="number"
                value={t.max_order_quantity ?? ''}
                onChange={(e) => onChange('max_order_quantity', e.target.value === '' ? null : +e.target.value)}
                placeholder="inherit"
              />
            </div>
            <div>
              <div className="text-muted mb-1">Max Orders/Sec <span className="text-muted">(null = round default)</span></div>
              <input
                className="input w-full"
                type="number"
                value={t.max_orders_per_second ?? ''}
                onChange={(e) => onChange('max_orders_per_second', e.target.value === '' ? null : +e.target.value)}
                placeholder="inherit"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 pt-1 border-t border-border/50">
            <div>
              <div className="text-muted mb-1">Price Ref Ticker <span className="text-accent">(correlation anchor)</span></div>
              <select
                className="input w-full"
                value={t.price_ref_ticker ?? ''}
                onChange={(e) => onChange('price_ref_ticker', e.target.value === '' ? null : e.target.value)}
              >
                <option value="">None (independent GBM)</option>
                {otherTickers.map((ot) => <option key={ot} value={ot}>{ot}</option>)}
              </select>
            </div>
            <div>
              <div className="text-muted mb-1">Price Multiplier <span className="text-muted">(e.g. 2 = 2× ref)</span></div>
              <input
                className="input w-full"
                type="number" step="0.1"
                value={t.price_multiplier}
                onChange={(e) => onChange('price_multiplier', +e.target.value)}
                disabled={!t.price_ref_ticker}
              />
            </div>
            <div>
              <div className="text-muted mb-1">Residual σ <span className="text-muted">(small noise around anchor)</span></div>
              <input
                className="input w-full"
                type="number" step="0.001"
                value={t.residual_volatility}
                onChange={(e) => onChange('residual_volatility', +e.target.value)}
                disabled={!t.price_ref_ticker}
              />
            </div>
          </div>
          {t.price_ref_ticker && (
            <div className="text-accent text-xs">
              Fair value: {t.ticker} ≈ {t.price_multiplier}× {t.price_ref_ticker} + residual noise
            </div>
          )}

          {/* ETF section */}
          <div className="pt-1 border-t border-border/50">
            <label className="flex items-center gap-2 cursor-pointer mb-2">
              <input
                type="checkbox"
                checked={t.is_etf}
                onChange={(e) => onChange('is_etf', e.target.checked)}
                className="accent-accent"
              />
              <span className="text-muted">This ticker is an ETF (allow creation/redemption)</span>
            </label>
            {t.is_etf && (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <div className="text-muted mb-1">ETF Lot Size <span className="text-muted">(units per lot)</span></div>
                    <input className="input w-full" type="number" min="1" value={t.etf_lot_size}
                      onChange={(e) => onChange('etf_lot_size', +e.target.value)} />
                  </div>
                  <div>
                    <div className="text-muted mb-1">Creation/Redemption Fee ($)</div>
                    <input className="input w-full" type="number" step="0.1" value={t.etf_fee}
                      onChange={(e) => onChange('etf_fee', +e.target.value)} />
                  </div>
                </div>
                <div>
                  <div className="text-muted mb-1 flex items-center justify-between">
                    <span>Basket Composition <span className="text-accent">(per lot)</span></span>
                    <button className="text-accent hover:underline"
                      onClick={() => onChange('etf_basket', [...t.etf_basket, { ticker: '', ratio: 1 }])}>
                      + Add component
                    </button>
                  </div>
                  {t.etf_basket.map((b, bi) => (
                    <div key={bi} className="flex gap-1 mb-1 items-center">
                      <input className="input flex-1" value={b.ticker}
                        placeholder="Ticker (e.g. PRODA)"
                        onChange={(e) => {
                          const nb = [...t.etf_basket]
                          nb[bi] = { ...nb[bi], ticker: e.target.value.toUpperCase() }
                          onChange('etf_basket', nb)
                        }} />
                      <span className="text-muted">×</span>
                      <input className="input w-16" type="number" min="1" value={b.ratio}
                        onChange={(e) => {
                          const nb = [...t.etf_basket]
                          nb[bi] = { ...nb[bi], ratio: +e.target.value }
                          onChange('etf_basket', nb)
                        }} />
                      <button className="text-sell hover:text-red-400"
                        onClick={() => onChange('etf_basket', t.etf_basket.filter((_, j) => j !== bi))}>✕</button>
                    </div>
                  ))}
                  {t.etf_basket.length > 0 && (
                    <div className="text-accent text-xs mt-1">
                      Formula: {t.etf_lot_size}{t.ticker} ⟺{' '}
                      {t.etf_basket.map((b) => `${b.ratio}${b.ticker || '?'}`).join(' + ')}
                      {t.etf_fee > 0 && ` + $${t.etf_fee} fee`}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function RoundForm({
  sessionId,
  nextNumber,
  onCreated,
}: {
  sessionId: number
  nextNumber: number
  onCreated: () => void
}) {
  const [name, setName] = useState(`Round ${nextNumber}`)
  const [duration, setDuration] = useState(180)
  const [tickers, setTickers] = useState<TickerDraft[]>(DEFAULT_TICKERS)
  const [mmBots, setMmBots] = useState(3)
  const [noiseBots, setNoiseBots] = useState(2)
  const [mmSpread, setMmSpread] = useState(0.1)
  const [mmOrderSize, setMmOrderSize] = useState(10)
  // trading rules
  const [orderFee, setOrderFee] = useState(0)
  const [maxOrderQty, setMaxOrderQty] = useState(0)
  const [maxOrdersPerSec, setMaxOrdersPerSec] = useState(0)
  const [saving, setSaving] = useState(false)

  function addTicker() {
    setTickers([...tickers, makeTicker('NEW')])
  }

  function removeTicker(i: number) {
    setTickers(tickers.filter((_, idx) => idx !== i))
  }

  function updateTicker(i: number, field: string, value: unknown) {
    setTickers(tickers.map((t, idx) => idx === i ? { ...t, [field]: value } : t))
  }

  async function save() {
    setSaving(true)
    try {
      await api.createRound(sessionId, {
        round_number: nextNumber,
        name,
        duration_seconds: duration,
        tickers_config: tickers,
        mm_bot_count: mmBots,
        noise_bot_count: noiseBots,
        mm_spread: mmSpread,
        mm_order_size: mmOrderSize,
        order_fee: orderFee,
        max_order_quantity: maxOrderQty,
        max_orders_per_second: maxOrdersPerSec,
      })
      onCreated()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-surface rounded p-4 space-y-3 text-sm border border-border">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-muted block mb-1">Round Name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-muted block mb-1">Duration (seconds)</label>
          <input className="input" type="number" value={duration} onChange={(e) => setDuration(+e.target.value)} />
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-muted font-semibold uppercase">Tickers</span>
          <button className="text-xs text-accent hover:underline" onClick={addTicker}>+ Add</button>
        </div>
        <div className="grid grid-cols-8 gap-1 text-xs text-muted px-1 mb-0.5">
          <span>Ticker</span><span>Init $</span><span>σ</span><span>μ</span><span>λ</span>
          <span className="text-accent">Settle $</span><span className="text-accent">Rules▾</span><span></span>
        </div>
        {tickers.map((t, i) => (
          <TickerRow
            key={i}
            t={t}
            i={i}
            tickers={tickers}
            onChange={(field, val) => updateTicker(i, field, val)}
            onRemove={() => removeTicker(i)}
          />
        ))}
      </div>

      <div className="grid grid-cols-4 gap-3">
        <div>
          <label className="text-xs text-muted block mb-1">MM Bots</label>
          <input className="input" type="number" value={mmBots} onChange={(e) => setMmBots(+e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-muted block mb-1">Noise Bots</label>
          <input className="input" type="number" value={noiseBots} onChange={(e) => setNoiseBots(+e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-muted block mb-1">MM Spread</label>
          <input className="input" type="number" step="0.01" value={mmSpread} onChange={(e) => setMmSpread(+e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-muted block mb-1">Order Size</label>
          <input className="input" type="number" value={mmOrderSize} onChange={(e) => setMmOrderSize(+e.target.value)} />
        </div>
      </div>

      {/* Round-level trading rules (defaults, overridden per ticker) */}
      <div className="border-t border-border pt-3">
        <div className="text-xs text-muted font-semibold uppercase mb-2 flex items-center gap-2">
          Round-Level Trading Rules
          <span className="text-muted font-normal normal-case">(0 = unlimited; overridable per ticker above)</span>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="text-xs text-muted block mb-1">Order Fee ($)</label>
            <input className="input" type="number" step="0.01" value={orderFee} onChange={(e) => setOrderFee(+e.target.value)} placeholder="0 = none" />
          </div>
          <div>
            <label className="text-xs text-muted block mb-1">Max Qty / Order</label>
            <input className="input" type="number" value={maxOrderQty} onChange={(e) => setMaxOrderQty(+e.target.value)} placeholder="0 = unlimited" />
          </div>
          <div>
            <label className="text-xs text-muted block mb-1">Max Orders / Second</label>
            <input className="input" type="number" value={maxOrdersPerSec} onChange={(e) => setMaxOrdersPerSec(+e.target.value)} placeholder="0 = unlimited" />
          </div>
        </div>
      </div>

      <div className="flex gap-2 justify-end">
        <button className="btn-primary btn text-xs" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Create Round'}
        </button>
      </div>
    </div>
  )
}

// ── Users admin ────────────────────────────────────────────────────────────

function UsersAdmin({ users, onRefresh }: { users: User[]; onRefresh: () => void }) {
  const [username, setUsername] = useState('')
  const [creating, setCreating] = useState(false)
  const [newUser, setNewUser] = useState<User | null>(null)

  async function createUser() {
    if (!username.trim()) return
    setCreating(true)
    try {
      const u = await api.createUser(username.trim())
      setNewUser(u)
      setUsername('')
      onRefresh()
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="panel p-4 space-y-3">
        <div className="text-sm font-semibold text-white">Create User</div>
        <div className="flex gap-2">
          <input
            className="input flex-1"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && createUser()}
          />
          <button className="btn-primary btn" onClick={createUser} disabled={creating || !username}>
            Create
          </button>
        </div>
        {newUser && (
          <div className="bg-surface rounded p-3 text-xs">
            <div className="text-buy mb-1">User created!</div>
            <div className="text-muted">Username: <span className="text-white">{newUser.username}</span></div>
            <div className="text-muted mt-1">API Key: <span className="mono text-accent select-all">{newUser.api_key}</span></div>
            <div className="text-muted text-xs mt-1 text-yellow-500">⚠ Save this key – it won't be shown again</div>
          </div>
        )}
      </div>

      <div className="panel overflow-hidden">
        <div className="panel-header">All Users</div>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-muted text-left border-b border-border">
              <th className="px-4 py-2 font-normal">ID</th>
              <th className="px-4 py-2 font-normal">Username</th>
              <th className="px-4 py-2 font-normal">Role</th>
              <th className="px-4 py-2 font-normal">Created</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t border-border/40">
                <td className="px-4 py-2 text-muted">#{u.id}</td>
                <td className="px-4 py-2 text-white font-medium">{u.username}</td>
                <td className="px-4 py-2">
                  {u.is_admin ? (
                    <span className="text-accent text-xs">Admin</span>
                  ) : (
                    <span className="text-muted text-xs">Trader</span>
                  )}
                </td>
                <td className="px-4 py-2 text-muted mono">
                  {new Date(u.created_at).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    PENDING: 'text-muted',
    ACTIVE: 'text-buy',
    FINISHED: 'text-accent',
  }
  return <span className={`text-xs font-medium ${map[status] ?? 'text-gray-400'}`}>{status}</span>
}
