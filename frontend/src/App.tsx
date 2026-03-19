import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { LoginPage } from './pages/LoginPage'
import { SessionsPage } from './pages/SessionsPage'
import { TradePage } from './pages/TradePage'
import { AdminPage } from './pages/AdminPage'
import { useAuthStore } from './store/authStore'
import { api } from './api'

function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, apiKey, setUser, logout } = useAuthStore()
  const nav = useNavigate()

  useEffect(() => {
    if (!apiKey) { nav('/login'); return }
    if (!user) {
      api.getMe()
        .then(setUser)
        .catch(() => { logout(); nav('/login') })
    }
  }, [apiKey, user, nav, setUser, logout])

  if (!user) return null
  return <>{children}</>
}

function AdminGate({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user)
  if (!user?.is_admin) return <Navigate to="/" replace />
  return <>{children}</>
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<AuthGate><SessionsPage /></AuthGate>} />
        <Route path="/trade/:roundId" element={<AuthGate><TradePage /></AuthGate>} />
        <Route path="/admin" element={<AuthGate><AdminGate><AdminPage /></AdminGate></AuthGate>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
