/**
 * 两次 OpenAI 调用：一次要文本，一次要时间轴。
 *
 * 之所以要两次，是因为 OpenAI 的词级时间戳只开给 whisper-1
 * （官方文档原文：The `timestamp_granularities[]` parameter is only supported
 * for `whisper-1`），而 whisper-1 的日语转写质量明显不如 gpt-transcribe。
 * 于是取两者之长：文本用 gpt-transcribe，时间轴用 whisper-1，再靠 align 合并。
 */

import { createReadStream } from 'node:fs'
import type OpenAI from 'openai'
import type { Config } from './config.ts'
import type { WhisperWord } from './align.ts'

/** 会随重试自愈的错误：限流、网关抖动、连接中断。 */
function isRetryable(error: unknown): boolean {
  const status = (error as { status?: number })?.status
  if (status === 429 || (typeof status === 'number' && status >= 500)) return true

  const code = (error as { code?: string })?.code
  return code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ECONNREFUSED'
}

/** 指数退避重试。 */
async function withRetry<T>(
  task: () => Promise<T>,
  maxRetries: number,
  label: string,
): Promise<T> {
  let lastError: unknown

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await task()
    } catch (error) {
      lastError = error
      if (attempt === maxRetries || !isRetryable(error)) break

      const delay = Math.min(30_000, 1000 * 2 ** attempt)
      console.warn(`  ↻ ${label} 第 ${attempt + 1} 次失败，${delay / 1000}s 后重试`)
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }

  throw lastError
}

/** 用 gpt-transcribe 拿高质量文本。 */
export async function transcribeText(
  client: OpenAI,
  audioPath: string,
  config: Config,
): Promise<string> {
  const response = await withRetry(
    () =>
      client.audio.transcriptions.create({
        file: createReadStream(audioPath),
        model: config.openai.textModel,
        language: config.openai.language,
        prompt: config.openai.prompt,
        response_format: 'json',
      }),
    config.run.maxRetries,
    `${config.openai.textModel} 文本`,
  )

  return (response as { text: string }).text.trim()
}

/** 用 whisper-1 拿词级时间轴。 */
export async function transcribeTimings(
  client: OpenAI,
  audioPath: string,
  config: Config,
): Promise<{ words: WhisperWord[]; duration: number | null; text: string }> {
  const response = await withRetry(
    () =>
      client.audio.transcriptions.create({
        file: createReadStream(audioPath),
        model: config.openai.timingModel,
        language: config.openai.language,
        // 刻意用独立的 timingPrompt（默认空）而不是 textModel 那个 prompt：
        // whisper 会把 prompt 当前文续写，信息量低的片段直接复读它，把时间轴带崩。
        prompt: config.openai.timingPrompt,
        response_format: 'verbose_json',
        timestamp_granularities: ['word'],
      }),
    config.run.maxRetries,
    `${config.openai.timingModel} 时间轴`,
  )

  const verbose = response as {
    words?: Array<{ word: string; start: number; end: number }>
    duration?: number
    text?: string
  }

  if (!verbose.words || verbose.words.length === 0) {
    throw new Error(
      `${config.openai.timingModel} 没有返回 words 字段。` +
        '确认 response_format=verbose_json 且 timestamp_granularities 包含 "word"，' +
        '并且模型确实是 whisper-1。',
    )
  }

  return {
    words: verbose.words,
    duration: typeof verbose.duration === 'number' ? verbose.duration : null,
    text: verbose.text ?? '',
  }
}

/**
 * 分段取时间轴，用于救回 whisper 卡进重复循环的那些音频。
 *
 * 每段的时间戳都是相对该段起点的，拼接前要加回段偏移。某一段挂了就跳过它，
 * 剩下的段仍然能给出锚点 —— 缺的部分交给 align 那边插值，总好过整条报废。
 */
export async function transcribeTimingsChunked(
  client: OpenAI,
  chunks: Array<{ path: string; offset: number }>,
  config: Config,
): Promise<WhisperWord[]> {
  const words: WhisperWord[] = []

  for (const chunk of chunks) {
    try {
      const result = await transcribeTimings(client, chunk.path, config)
      for (const word of result.words) {
        words.push({
          word: word.word,
          start: word.start + chunk.offset,
          end: word.end + chunk.offset,
        })
      }
    } catch (error) {
      console.warn(`  ↻ 分段 ${chunk.offset.toFixed(0)}s 处失败，跳过：${(error as Error).message}`)
    }
  }

  return words
}
