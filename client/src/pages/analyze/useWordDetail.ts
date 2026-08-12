import { useCallback, useRef, useState } from 'react'

import { analyzeWord, type AnalyzeToken, type AnalyzeWordResult } from '../../api/analyze'
import { getErrorMessage } from '../../api/error'
import { tokenBase } from '../../lib/analyzeTokens'

/**
 * 点开的那个词的 AI 详解。
 *
 * 按 (词形 + 辞書形 + 所在句) 缓存在会话内：同一个词在同一句里点第二次、或者
 * 点走再点回来，都不再计费。这层缓存只活在页面实例里 —— 内容跟着句子走，
 * 换一段文本就没有复用价值，落库只会留下一堆再也命中不了的行。
 *
 * pending / error 也按 key 记而不是只记「当前那个」：生成过程中还能接着点别的
 * 词，先回来的那个不该把另一个的 loading 清掉。
 */

function keyOf(token: AnalyzeToken, sentence: string) {
  return `${token.word}\u0000${tokenBase(token)}\u0000${sentence}`
}

export function useWordDetail() {
  const [cache, setCache] = useState<Record<string, AnalyzeWordResult>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set())
  const [activeKey, setActiveKey] = useState<string | null>(null)
  // 双击、或者 pending 还没随 state 更新过来时，别打出两发请求。
  const inFlight = useRef(new Set<string>())

  const select = useCallback(
    async (token: AnalyzeToken, sentence: string, refresh = false) => {
      const key = keyOf(token, sentence)
      setActiveKey(key)
      if (inFlight.current.has(key)) return
      if (!refresh && cache[key]) return

      inFlight.current.add(key)
      setPending((prev) => new Set(prev).add(key))
      setErrors((prev) => {
        if (!(key in prev)) return prev
        const next = { ...prev }
        delete next[key]
        return next
      })
      try {
        const detail = await analyzeWord({
          word: token.word,
          sentence,
          pos: token.pos,
          kana: token.kana,
          base: tokenBase(token),
        })
        setCache((prev) => ({ ...prev, [key]: detail }))
      } catch (error) {
        setErrors((prev) => ({
          ...prev,
          [key]: getErrorMessage(error, 'AI 详解生成失败'),
        }))
      } finally {
        inFlight.current.delete(key)
        setPending((prev) => {
          const next = new Set(prev)
          next.delete(key)
          return next
        })
      }
    },
    [cache],
  )

  const clear = useCallback(() => setActiveKey(null), [])

  return {
    /** 当前选中的那个词的详解，还没回来时是 null。 */
    detail: activeKey ? (cache[activeKey] ?? null) : null,
    isLoading: activeKey ? pending.has(activeKey) : false,
    error: activeKey ? (errors[activeKey] ?? null) : null,
    select,
    clear,
  }
}

export type WordDetailStore = ReturnType<typeof useWordDetail>
