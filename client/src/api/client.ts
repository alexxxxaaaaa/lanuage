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

/**
 * 边缘偶发不可用时的自动重试。
 *
 * 症状是一批请求同时 502/503，过几秒刷新就好了 —— 这类失败根本没到 Worker
 * （`wrangler tail` 里连条记录都没有），是 Cloudflare 边缘那层回的，重试一次
 * 基本就过去了。与其让用户自己刷新，不如这里悄悄再试。
 *
 * 只重试 GET：POST/PATCH/DELETE 重试等于有可能重复写一遍。超时也不重试 ——
 * 掐掉的只是浏览器这头，服务端那次调用还在跑，AI 接口重试一次就是再花一次钱。
 */
const RETRYABLE_STATUS = new Set([502, 503, 504])
const RETRY_DELAYS_MS = [400, 1200]

type RetryableConfig = InternalAxiosRequestConfig & { __retryCount?: number }

function isRetryable(error: AxiosError): boolean {
  if ((error.config?.method ?? 'get').toLowerCase() !== 'get') return false
  const status = error.response?.status
  if (status !== undefined) return RETRYABLE_STATUS.has(status)
  // 压根没拿到响应。ERR_NETWORK 是连接层断了，值得再试；ECONNABORTED（超时）
  // 和 ERR_CANCELED（组件卸载时主动取消）不该重试。
  return error.code === 'ERR_NETWORK'
}

apiClient.interceptors.response.use(
  (response: AxiosResponse) => response,
  async (error: AxiosError) => {
    const status = error?.response?.status
    const isAuthEndpoint = String(error?.config?.url ?? '').startsWith('/api/auth/')
    if (status === 401 && !isAuthEndpoint) {
      clearAuthAndRedirect()
      return Promise.reject(error)
    }

    const config = error.config as RetryableConfig | undefined
    if (config && isRetryable(error)) {
      const attempt = config.__retryCount ?? 0
      if (attempt < RETRY_DELAYS_MS.length) {
        config.__retryCount = attempt + 1
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]))
        return apiClient(config)
      }
    }

    return Promise.reject(error)
  },
)
