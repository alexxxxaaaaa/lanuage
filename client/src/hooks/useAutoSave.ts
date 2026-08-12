import { useCallback, useEffect, useRef, useState } from 'react'

export type SaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error'

/**
 * 攒补丁 + 防抖落库，给「边写边存」的页面用。
 *
 * 几个刻意的取舍：
 *   - 补丁是合并的，不是排队的。连打十个字只发一次 `{ content }`，改标题又改
 *     标签也只发一次 `{ title, tag }`。
 *   - 请求串行。上一笔没回来之前不发下一笔，否则两个 PATCH 打同一条记录，谁
 *     后到谁赢，慢的那个会把新内容盖回去。
 *   - 失败不吞改动。请求挂了就把补丁塞回待发队列，下一次输入或 flush 会重试，
 *     状态同时翻成 error 让界面能提示。
 */
export function useAutoSave<TPatch extends object>(
  save: (patch: Partial<TPatch>) => Promise<void>,
  { delay = 800 }: { delay?: number } = {},
) {
  const [status, setStatus] = useState<SaveStatus>('idle')

  // 回调每次渲染都是新的，用 ref 接住，免得 flush/queue 的身份跟着变。
  const saveRef = useRef(save)
  useEffect(() => {
    saveRef.current = save
  })

  const pending = useRef<Partial<TPatch> | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const chain = useRef<Promise<void>>(Promise.resolve())

  const flush = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current)
      timer.current = null
    }

    chain.current = chain.current.then(async () => {
      const patch = pending.current
      if (!patch) return
      pending.current = null
      setStatus('saving')
      try {
        await saveRef.current(patch)
        // 存的过程里又改了东西，就别宣布「已保存」。
        if (!pending.current) setStatus('saved')
      } catch {
        pending.current = { ...patch, ...(pending.current ?? {}) }
        setStatus('error')
      }
    })

    return chain.current
  }, [])

  const queue = useCallback(
    (patch: Partial<TPatch>) => {
      pending.current = { ...(pending.current ?? {}), ...patch }
      setStatus('pending')
      if (timer.current !== null) clearTimeout(timer.current)
      timer.current = setTimeout(() => void flush(), delay)
    },
    [delay, flush],
  )

  /** 还有没落库的改动。关页面前的拦截问它。 */
  const isDirty = useCallback(() => pending.current !== null, [])

  // 卸载前把最后一笔发出去。keep-alive 下页面通常不会卸载，这是兜底。
  useEffect(() => () => void flush(), [flush])

  return { status, queue, flush, isDirty }
}
