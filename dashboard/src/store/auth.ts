import { create } from 'zustand'
import { http, clearToken, setToken } from '@/lib/http'
import type { AuthUser, LoginResponse } from '@/types/api'

interface AuthState {
  user: AuthUser | null
  loading: boolean
  ready: boolean
  bootstrap: () => Promise<void>
  login: (username: string, password: string) => Promise<void>
  logout: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loading: false,
  ready: false,

  async bootstrap() {
    set({ loading: true })
    try {
      const { data } = await http.get<AuthUser>('/api/auth/me', {
        headers: { 'x-silent': '1' },
      })
      set({ user: data })
    } catch {
      set({ user: null })
    } finally {
      set({ loading: false, ready: true })
    }
  },

  async login(username, password) {
    set({ loading: true })
    try {
      const { data } = await http.post<LoginResponse>('/api/auth/login', {
        username,
        password,
      })
      setToken(data.token)
      set({ user: data.user })
    } finally {
      set({ loading: false })
    }
  },

  logout() {
    clearToken()
    set({ user: null })
  },
}))
