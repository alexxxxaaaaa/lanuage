import axios, { AxiosError, type InternalAxiosRequestConfig, type AxiosResponse } from 'axios'
import { clearAuthAndRedirect, getStoredToken } from '../store/authStore'

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? '',
  // 增删改查的超时。这类请求就是一次读写，超过十秒基本等于出事了，早点报错比
  // 让人对着转圈强。AI 生成类的请求另算，见下面。
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
})

/**
 * 会调模型的那些接口的超时，逐个传给对应的请求（`{ timeout: AI_TIMEOUT_MS }`）。
 *
 * 模型是一个 token 一个 token 吐出来的，一条几百 token 的回答十几到几十秒很正常，
 * 文解析还要分块跑好几轮。默认的十秒到点掐掉，掐掉的只是浏览器这一头 —— 服务端
 * 照样把这次调用跑完、照样记进用量，token 已经花了，用户看到的却是一句超时。
 * 所以这里给足余量：真卡住的时候多等一会儿，好过把付过钱的答案扔掉。
 */
export const AI_TIMEOUT_MS = 90_000

apiClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = getStoredToken()
  if (token) {
    config.headers.set('Authorization', `Bearer ${token}`)
  }
  return config
})

apiClient.interceptors.response.use(
  (response: AxiosResponse) => response,
  (error: AxiosError) => {
    const status = error?.response?.status
    const isAuthEndpoint = String(error?.config?.url ?? '').startsWith('/api/auth/')
    if (status === 401 && !isAuthEndpoint) {
      clearAuthAndRedirect()
    }
    return Promise.reject(error)
  },
)
