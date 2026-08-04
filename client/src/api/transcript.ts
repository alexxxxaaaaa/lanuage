import type { Transcript } from '../components/HyperTranscript'

/**
 * 听力文字稿。
 *
 * 数据是 hypertranscript/ 那套离线管线产出的，和音频一样直接放在 R2 上，
 * 对象名只差一个前缀和扩展名，所以不需要后端出接口 —— 拿 audioUrl 换一下就是：
 *
 *   …/qbank/audio/2020.12/1-1.mp3  →  …/qbank/transcript/2020.12/1-1.json
 *
 * 走原生 fetch 而不是 apiClient：这是跨域的公共对象存储，不该带上我们的
 * Authorization 头（带了反而会触发 CORS 预检）。
 */

/** audioUrl 换算成文字稿地址；不认识的形状返回 null。 */
export function transcriptUrlOf(audioUrl: string): string | null {
  if (!audioUrl) return null

  const index = audioUrl.lastIndexOf('/audio/')
  if (index < 0 || !audioUrl.endsWith('.mp3')) return null

  const head = audioUrl.slice(0, index)
  const tail = audioUrl.slice(index + '/audio/'.length, -'.mp3'.length)
  return `${head}/transcript/${tail}.json`
}

/** 一个会话里重复翻回同一题不该反复下载，命中直接复用。 */
const cache = new Map<string, Transcript>()

export class TranscriptMissingError extends Error {
  constructor() {
    super('这一题还没有文字稿')
    this.name = 'TranscriptMissingError'
  }
}

export async function getTranscript(audioUrl: string, signal?: AbortSignal): Promise<Transcript> {
  const url = transcriptUrlOf(audioUrl)
  if (!url) throw new TranscriptMissingError()

  const cached = cache.get(url)
  if (cached) return cached

  const response = await fetch(url, { signal })
  // R2 对不存在的对象回 404，等价于「这题没转写」而不是网络故障。
  if (response.status === 404) throw new TranscriptMissingError()
  if (!response.ok) throw new Error(`文字稿加载失败（${response.status}）`)

  const data = (await response.json()) as Transcript
  if (!Array.isArray(data.tokens) || data.tokens.length === 0) {
    throw new TranscriptMissingError()
  }

  cache.set(url, data)
  return data
}
