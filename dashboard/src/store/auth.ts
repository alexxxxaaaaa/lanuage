import { create } from 'zustand'
import { message } from 'antd'
import { http, clearToken, setToken } from '@/lib/http'
import type { AuthUser, LoginResponse } from '@/types/api'

const NOT_ADMIN = '该账号没有管理员权限'

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
      // 非管理员的 token 在后台没有任何用处：进来也只会看到一屏 403。
      if (!data.isAdmin) {
        clearToken()
        set({ user: null })
        return
      }
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
      if (!data.user.isAdmin) {
        // 凭证是对的，只是这个人不该进后台 —— token 不落盘。
        message.error(NOT_ADMIN)
        throw new Error(NOT_ADMIN)
      }
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
