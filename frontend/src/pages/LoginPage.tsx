import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useAuthStore } from '../store/authStore'

export function LoginPage() {
  const [key, setKey] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { setApiKey, setUser } = useAuthStore()
  const nav = useNavigate()

  async function login() {
    setError('')
    setLoading(true)
    localStorage.setItem('api_key', key)
    try {
      const user = await api.getMe()
      setApiKey(key)
      setUser(user)
      nav('/')
    } catch {
      setError('Invalid API key')
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
        <div>
          <label className="text-xs text-muted block mb-1">API Key</label>
          <input
            className="input"
            type="text"
            placeholder="Paste your API key…"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && login()}
            autoFocus
          />
        </div>
        {error && <div className="text-sell text-xs">{error}</div>}
        <button className="btn-primary btn w-full" onClick={login} disabled={loading || !key}>
          {loading ? 'Connecting…' : 'Connect'}
        </button>
      </div>
    </div>
  )
}
