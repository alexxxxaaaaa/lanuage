import { useEffect, useRef, useState } from 'react'
import { Volume2 } from 'lucide-react'

/**
 * 一个小喇叭，点了播一段音频。
 *
 * 用一个 <audio> 元素而不是每次 new Audio()：连点两下时先停掉上一段，
 * 不会两条朗读叠在一起。src 是空串就什么都不渲染 —— 手工建的语法条目没有
 * 朗读，那里不该冒出一个点了没反应的按钮。
 */
export function AudioButton({
  src,
  label = '朗读',
  className = '',
}: {
  src: string
  label?: string
  className?: string
}) {
  const ref = useRef<HTMLAudioElement | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)

  useEffect(() => {
    // 换条目时把上一条的声音掐掉。要在 effect 里先把节点抓住 —— 等到清理函数
    // 跑的时候 ref.current 已经指向新的 <audio> 了，停的会是错的那一个。
    const el = ref.current
    return () => el?.pause()
  }, [src])

  if (!src) return null

  const toggle = () => {
    const el = ref.current
    if (!el) return
    if (!el.paused) {
      el.pause()
      el.currentTime = 0
      setIsPlaying(false)
      return
    }
    void el.play().catch(() => setIsPlaying(false))
  }

  return (
    <>
      <button
        type="button"
        title={label}
        aria-label={label}
        onClick={toggle}
        className={`ml-1.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full border-0 bg-transparent p-0 align-middle transition-colors ${
          isPlaying ? 'text-accent' : 'text-muted hover:text-accent'
        } ${className}`}
      >
        <Volume2 className="size-4" />
      </button>
      <audio
        ref={ref}
        src={src}
        preload="none"
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
      />
    </>
  )
}
