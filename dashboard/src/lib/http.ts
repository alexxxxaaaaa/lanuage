import axios, { AxiosError } from 'axios'
import { message } from 'antd'

const baseURL = import.meta.env.VITE_API_BASE_URL ?? ''

export const http = axios.create({
  baseURL,
  timeout: 20_000,
})

const TOKEN_KEY = 'language-admin:token'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY)
}

http.interceptors.request.use((config) => {
  const token = getToken()
  if (token) {
    config.headers = config.headers ?? {}
    ;(config.headers as Record<string, string>).Authorization = `Bearer ${token}`
  }
  return config
})

http.interceptors.response.use(
  (resp) => resp,
  (error: AxiosError<{ message?: string }>) => {
    const status = error.response?.status
    const msg = error.response?.data?.message ?? error.message ?? '请求失败'
    if (status === 401) {
      clearToken()
      message.error('登录已过期，请重新登录')
      if (location.pathname !== '/login') {
        location.href = '/login'
      }
    } else if (status === 403) {
      message.error(msg || '无管理员权限')
    } else if (!error.config?.headers?.['x-silent']) {
      message.error(msg)
    }
    return Promise.reject(error)
  },
)
