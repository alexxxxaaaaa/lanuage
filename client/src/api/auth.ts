import { apiClient } from './client'

export type AuthUser = {
  id: string
  username: string
  createdAt?: string
}

export type AuthResponse = {
  token: string
  user: AuthUser
}

export async function login(username: string, password: string) {
  const response = await apiClient.post<AuthResponse>('/api/auth/login', {
    username,
    password,
  })
  return response.data
}

export async function register(username: string, password: string) {
  const response = await apiClient.post<AuthResponse>('/api/auth/register', {
    username,
    password,
  })
  return response.data
}

export async function fetchMe() {
  const response = await apiClient.get<AuthUser>('/api/auth/me')
  return response.data
}
