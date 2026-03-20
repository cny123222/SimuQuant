import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useAuthStore } from '../store/authStore'

export function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { setApiKey, setUser } = useAuthStore()
  const nav = useNavigate()

  async function login() {
    setError('')
    if (!username.trim() || !password) return
    setLoading(true)
    try {
      const { api_key } = await api.login(username.trim(), password)
      // Store the API key internally – users never see it
      localStorage.setItem('api_key', api_key)
      setApiKey(api_key)
      const user = await api.getMe()
      setUser(user)
      nav('/')
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Invalid username or password')
      localStorage.removeItem('api_key')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="h-full flex items-center justify-center">
      <div className="w-80 panel p-6 space-y-4">
        <div>
          <h1 className="text-xl font-bold text-white">SimuQuant</h1>
          <p className="text-muted text-xs mt-1">Market-making simulation platform</p>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted block mb-1">Username</label>
            <input
              className="input"
              type="text"
              placeholder="e.g. team01"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && login()}
              autoFocus
              autoComplete="username"
            />
          </div>
          <div>
            <label className="text-xs text-muted block mb-1">Password</label>
            <input
              className="input"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && login()}
              autoComplete="current-password"
            />
          </div>
        </div>

        {error && <div className="text-sell text-xs">{error}</div>}

        <button
          className="btn-primary btn w-full"
          onClick={login}
          disabled={loading || !username || !password}
        >
          {loading ? 'Logging in…' : 'Log In'}
        </button>
      </div>
    </div>
  )
}
