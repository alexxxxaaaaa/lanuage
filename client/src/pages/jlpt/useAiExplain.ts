import { useCallback, useMemo, useRef, useState } from 'react'
import { toast } from '@heroui/react'

import { generateQbankAiExplain, type QbankAiExplain } from '../../api/qbank'
import { getErrorMessage } from '../../api/error'

/**
 * AI 逐选项解析的生成状态，精练页和模拟考试复盘页共用。
 *
 * 服务端的缓存是**全局**的（一题一份，见 qbankService.getAiExplain），所以这里
 * 只管当前会话内新生成的那些和 pending，不做本地缓存策略 —— 别人生成过的题，
 * 正文一下发就带着解析回来了。
 *
 * 两者都按 questionId 记而不是只记「当前那道」：生成时还能翻页/滚屏，
 * 先回来的那个不该把另一道的 loading 一起清掉。
 */
export function useAiExplain() {
  const [generated, setGenerated] = useState<Record<string, QbankAiExplain>>({})
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set())
  // 双击、或者按钮的 disabled 还没随 state 更新过来时，别打出两发请求。
  const inFlight = useRef(new Set<string>())

  const run = useCallback(async (questionId: string, refresh = false) => {
    if (inFlight.current.has(questionId)) return
    inFlight.current.add(questionId)
    setPending((prev) => new Set(prev).add(questionId))
    try {
      const explain = await generateQbankAiExplain(questionId, refresh)
      setGenerated((prev) => ({ ...prev, [questionId]: explain }))
    } catch (e) {
      toast.danger(getErrorMessage(e, '生成 AI 解析失败'))
    } finally {
      inFlight.current.delete(questionId)
      setPending((prev) => {
        const next = new Set(prev)
        next.delete(questionId)
        return next
      })
    }
  }, [])

  return useMemo(() => ({ generated, pending, run }), [generated, pending, run])
}

export type AiExplainStore = ReturnType<typeof useAiExplain>
