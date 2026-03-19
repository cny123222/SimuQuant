import { create } from 'zustand'
import type { User } from '../api'

interface AuthState {
  user: User | null
  apiKey: string
  setUser: (user: User | null) => void
  setApiKey: (key: string) => void
  logout: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  apiKey: localStorage.getItem('api_key') ?? '',
  setUser: (user) => set({ user }),
  setApiKey: (key) => {
    localStorage.setItem('api_key', key)
    set({ apiKey: key })
  },
  logout: () => {
    localStorage.removeItem('api_key')
    set({ user: null, apiKey: '' })
  },
}))
