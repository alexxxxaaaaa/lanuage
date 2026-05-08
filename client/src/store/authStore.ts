import { create } from 'zustand'
import type { AuthUser } from '../api/auth'

const TOKEN_KEY = 'word-sprint-token'
const USER_KEY = 'word-sprint-user'

function loadToken(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

function loadUser(): AuthUser | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(USER_KEY)
    if (!raw) return null
    return JSON.parse(raw) as AuthUser
  } catch {
    return null
  }
}

function persistToken(token: string | null) {
  if (typeof window === 'undefined') return
  try {
    if (token === null) {
      window.localStorage.removeItem(TOKEN_KEY)
    } else {
      window.localStorage.setItem(TOKEN_KEY, token)
    }
  } catch {
    // ignore
  }
}

function persistUser(user: AuthUser | null) {
  if (typeof window === 'undefined') return
  try {
    if (user === null) {
      window.localStorage.removeItem(USER_KEY)
    } else {
      window.localStorage.setItem(USER_KEY, JSON.stringify(user))
    }
  } catch {
    // ignore
  }
}

type AuthState = {
  token: string | null
  user: AuthUser | null
  setSession: (token: string, user: AuthUser) => void
  setUser: (user: AuthUser) => void
  clearSession: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  token: loadToken(),
  user: loadUser(),
  setSession: (token, user) => {
    persistToken(token)
    persistUser(user)
    set({ token, user })
  },
  setUser: (user) => {
    persistUser(user)
    set({ user })
  },
  clearSession: () => {
    persistToken(null)
    persistUser(null)
    set({ token: null, user: null })
  },
}))

export function getStoredToken(): string | null {
  return useAuthStore.getState().token
}

export function clearAuthAndRedirect() {
  useAuthStore.getState().clearSession()
  if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
    const redirect = window.location.pathname + window.location.search
    window.location.replace(`/login?redirect=${encodeURIComponent(redirect)}`)
  }
}
