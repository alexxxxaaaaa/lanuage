import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'

/**
 * 词级同步文字稿播放器。
 *
 * 数据由 hypertranscript/ 那套离线管线产出（gpt-transcribe 出文本、whisper-1 出
 * 词级时间轴、LCS 对齐后按 kuromoji 形态素切词），传在 R2 上，与音频同名不同前缀。
 *
 * 三档明度表达进度：未播暗、已播亮、当前词用主题蓝加粗。点任意一个词跳到那一刻。
 */

/** 一个词：[文本, 起始毫秒, 持续毫秒]。元组比对象省一半体积，见 exportR2.ts。 */
export type PackedToken = [text: string, m: number, d: number]

export type Transcript = {
  /** 秒 */
  duration: number
  tokens: PackedToken[]
  /** 每段起始的 token 下标 */
  paragraphs: number[]
}

type Props = {
  audioSrc: string
  transcript: Transcript
}

/**
 * 找出 timeMs 落在哪个词上 —— 最后一个起始时间 ≤ timeMs 的词。
 *
 * 词的时间轴单调不减（离线端已经保证），所以可以二分。1000 词一次 10 步，
 * 放在 rAF 里每帧跑也毫无压力。
 */
function findActive(tokens: PackedToken[], timeMs: number): number {
  if (tokens.length === 0 || timeMs < tokens[0][1]) return -1

  let low = 0
  let high = tokens.length - 1
  while (low < high) {
    const mid = (low + high + 1) >> 1
    if (tokens[mid][1] <= timeMs) low = mid
    else high = mid - 1
  }
  return low
}

type WordState = 'unread' | 'read' | 'active'

const WORD_CLASS: Record<WordState, string> = {
  // 未播：压暗，让读过的部分自然浮出来
  unread: 'text-muted',
  read: 'text-foreground',
  active: 'font-bold text-accent',
}

/**
 * 单个词。memo 掉之后，播放推进时 React 只会重渲染状态真正变了的那两三个词，
 * 其余上千个直接跳过 —— 否则每次换词都要重建整棵 span 树。
 */
const Word = memo(function Word({
  text,
  state,
  onSeek,
}: {
  text: string
  state: WordState
  onSeek: () => void
}) {
  return (
    <span
      className={`cursor-pointer transition-colors duration-150 hover:text-foreground ${WORD_CLASS[state]}`}
      data-active={state === 'active' || undefined}
      onClick={onSeek}
    >
      {text}
    </span>
  )
})

export function HyperTranscript({ audioSrc, transcript }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [isFollowing, setIsFollowing] = useState(true)

  const { tokens, paragraphs } = transcript

  /**
   * 用 rAF 而不是 timeupdate 事件：后者只有约 4 Hz，对平均 240 ms 的日语词来说
   * 高亮会肉眼可见地滞后。逐帧检测、只在词真的变了时才 setState，
   * 所以重渲染频率仍然等于换词频率，不是 60 Hz。
   */
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    let raf = 0
    const tick = () => {
      setActiveIndex((previous) => {
        const next = findActive(tokens, audio.currentTime * 1000)
        return next === previous ? previous : next
      })
      raf = requestAnimationFrame(tick)
    }

    const start = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(tick)
    }
    const stop = () => cancelAnimationFrame(raf)

    audio.addEventListener('play', start)
    audio.addEventListener('pause', stop)
    audio.addEventListener('ended', stop)
    // 暂停状态下拖进度条也要跟着走一次。
    audio.addEventListener('seeked', tick)

    if (!audio.paused) start()

    return () => {
      cancelAnimationFrame(raf)
      audio.removeEventListener('play', start)
      audio.removeEventListener('pause', stop)
      audio.removeEventListener('ended', stop)
      audio.removeEventListener('seeked', tick)
    }
  }, [tokens])

  // 换音频时重置，否则上一题的高亮位置会留在新文字稿上。
  // 在渲染期调整而不是塞进 effect：effect 里同步 setState 会多跑一轮渲染，
  // React 的 lint 规则也明确禁止。
  const [loadedSrc, setLoadedSrc] = useState(audioSrc)
  if (loadedSrc !== audioSrc) {
    setLoadedSrc(audioSrc)
    setActiveIndex(-1)
    setIsFollowing(true)
  }

  // 滚动位置是 DOM 状态，跟着音频一起归零。
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [audioSrc])

  // 跟随滚动。block:'nearest' 只在当前词真的看不见时才动，
  // 不会每换一个词就把视口推一下。
  useEffect(() => {
    if (!isFollowing || activeIndex < 0) return
    const node = scrollRef.current?.querySelector('[data-active]')
    node?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [activeIndex, isFollowing])

  const seekTo = useCallback((ms: number) => {
    const audio = audioRef.current
    if (!audio) return
    audio.currentTime = ms / 1000
    setActiveIndex(findActive(transcript.tokens, ms))
    setIsFollowing(true)
    void audio.play().catch(() => {
      // 浏览器可能因为没有用户手势而拒绝自动播放，跳转本身已经生效了。
    })
  }, [transcript.tokens])

  // 段落切片。tokens 不变时不用重算，翻页换题才会变。
  const sections = useMemo(() => {
    return paragraphs.map((start, i) => ({
      start,
      end: i + 1 < paragraphs.length ? paragraphs[i + 1] : tokens.length,
    }))
  }, [paragraphs, tokens.length])

  return (
    <div className="grid gap-3">
      <audio ref={audioRef} className="h-10 w-full" controls preload="metadata" src={audioSrc} />

      <div
        ref={scrollRef}
        // 用户自己滚就停掉跟随，免得跟播放位置抢滚动条；点词或换题会恢复。
        onWheel={() => setIsFollowing(false)}
        onTouchMove={() => setIsFollowing(false)}
        className="max-h-[52vh] overflow-y-auto rounded-[var(--radius)] bg-surface-secondary p-4 text-[15px]/[2.1] max-[900px]:max-h-[44vh]"
      >
        {sections.map((section) => (
          <p key={section.start} className="mt-0 mb-3.5 last:mb-0">
            {tokens.slice(section.start, section.end).map((token, offset) => {
              const index = section.start + offset
              return (
                <Word
                  key={index}
                  text={token[0]}
                  state={index === activeIndex ? 'active' : index < activeIndex ? 'read' : 'unread'}
                  onSeek={() => seekTo(token[1])}
                />
              )
            })}
          </p>
        ))}
      </div>

      {!isFollowing ? (
        <button
          type="button"
          className="muted justify-self-center text-xs underline underline-offset-2"
          onClick={() => setIsFollowing(true)}
        >
          恢复跟随播放
        </button>
      ) : null}
    </div>
  )
}
