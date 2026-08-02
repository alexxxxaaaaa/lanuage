import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, ProgressBar, Slider, toast } from '@heroui/react'
import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react'

import { formatClock } from './constants'

/**
 * 听力的整段播放器。
 *
 * 题库里的听力音频是**每题一段** mp3（没有整卷录音），所以「全文播放」做成
 * 一条播放列表：一段放完自动接下一段，中间不停，等价于考场里那盘磁带。
 * 一段被两道题共用时（聴解5 的双問题）算一段，高亮两道题。
 *
 * 严格模式下不给拖动：只能播、暂停，放完即交卷。自我评估模式给进度条和
 * 前后段按钮，自己控制节奏。
 */

export type ListeningSegment = { url: string; questionIds: string[] }

type Props = {
  segments: ListeningSegment[]
  canSeek: boolean
  /** 当前段对应的题，父级用来高亮和滚动。 */
  onActiveChange: (questionIds: string[]) => void
  /** 最后一段放完。 */
  onFinished: () => void
}

export function ExamListeningPlayer({ segments, canSeek, onActiveChange, onFinished }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null)
  // 预热下一段：拿不到引用会被 GC，浏览器就白下了。
  const preloadRef = useRef<HTMLAudioElement | null>(null)
  // 换段后要不要接着播。不能在 setIndex 之后立刻 play()：那时 <audio> 的 src
  // 还是上一段，会把同一段重放一遍。改成让 index 的副作用在 DOM 更新后再播。
  const resumeRef = useRef(false)
  const [index, setIndex] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [hasStarted, setHasStarted] = useState(false)
  const [isFinished, setIsFinished] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  // 拖动中的临时值：直接改 audio.currentTime 会被 timeupdate 打架。
  const [scrub, setScrub] = useState<number | null>(null)

  const current = segments[index]
  const isLast = index >= segments.length - 1

  // 换段：告诉父级高亮哪几道题，并预热下一段。
  useEffect(() => {
    if (!current) return
    onActiveChange(current.questionIds)
    const next = segments[index + 1]
    if (next) {
      const audio = new Audio()
      audio.preload = 'auto'
      audio.src = next.url
      preloadRef.current = audio
    }
  }, [current, index, segments, onActiveChange])

  // src 已经换成新一段了，这时候 play() 才是播新的那段。
  useEffect(() => {
    if (!resumeRef.current) return
    resumeRef.current = false
    void audioRef.current?.play().catch(() => toast.danger('音频播放失败'))
  }, [index])

  /** 切到第 i 段，play 为真则继续播下去。 */
  const goTo = useCallback((i: number, play: boolean) => {
    resumeRef.current = play
    setIndex(i)
    setTime(0)
    setDuration(0)
    setScrub(null)
    // 自我评估模式下可以退回去重听，退回去就不算「已播完」了。
    setIsFinished(false)
  }, [])

  const handleEnded = () => {
    if (!isLast) {
      goTo(index + 1, true)
      return
    }
    setIsPlaying(false)
    setIsFinished(true)
    onFinished()
  }

  const toggle = () => {
    const audio = audioRef.current
    if (!audio) return
    setHasStarted(true)
    if (audio.paused) void audio.play().catch(() => toast.danger('音频播放失败'))
    else audio.pause()
  }

  if (segments.length === 0) {
    return (
      <p className="muted m-0 text-sm">这套卷子的听力音频缺失，可以直接凭题面作答后交卷。</p>
    )
  }

  const shown = scrub ?? time
  const progress = duration > 0 ? (shown / duration) * 100 : 0
  // 整体进度按「段数 + 当前段内比例」估，段长不一但足够指示还剩多少。
  const overall = ((index + (duration > 0 ? shown / duration : 0)) / segments.length) * 100

  return (
    <div className="grid gap-2.5">
      <audio
        ref={audioRef}
        src={current?.url}
        preload="auto"
        onEnded={handleEnded}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
        onError={() => {
          // 某一段挂了不能卡死整场考试，跳过它继续。
          toast.warning(`第 ${index + 1} 段音频加载失败，已跳过`)
          if (isLast) handleEnded()
          else goTo(index + 1, hasStarted)
        }}
      />

      <div className="flex items-center gap-3">
        {/* 严格模式放完就锁死，自我评估模式可以回头重听。 */}
        <Button
          className="size-11 shrink-0 rounded-full p-0"
          isDisabled={isFinished && !canSeek}
          variant="primary"
          onPress={toggle}
        >
          {isPlaying ? <Pause aria-hidden /> : <Play aria-hidden />}
          <span className="sr-only">{isPlaying ? '暂停' : '播放'}</span>
        </Button>

        <div className="min-w-0 flex-1">
          {canSeek ? (
            <Slider
              aria-label="播放进度"
              className="w-full"
              maxValue={Math.max(duration, 0.1)}
              minValue={0}
              step={0.5}
              value={shown}
              onChange={(v) => setScrub(Number(v))}
              onChangeEnd={(v) => {
                const audio = audioRef.current
                if (audio) audio.currentTime = Number(v)
                setScrub(null)
              }}
            >
              <Slider.Track>
                <Slider.Fill />
                <Slider.Thumb />
              </Slider.Track>
            </Slider>
          ) : (
            <ProgressBar aria-label="播放进度" size="sm" value={progress}>
              <ProgressBar.Track>
                <ProgressBar.Fill />
              </ProgressBar.Track>
            </ProgressBar>
          )}
          <div className="mt-1 flex items-center justify-between text-xs tabular-nums text-muted">
            <span>
              第 {index + 1} / {segments.length} 段 · {formatClock(shown * 1000)}
              {duration > 0 ? ` / ${formatClock(duration * 1000)}` : ''}
            </span>
            <span>整体 {Math.round(overall)}%</span>
          </div>
        </div>

        {canSeek ? (
          <div className="flex shrink-0 gap-1">
            <Button
              isDisabled={index === 0}
              size="sm"
              variant="outline"
              onPress={() => goTo(index - 1, isPlaying)}
            >
              <ChevronLeft aria-hidden />
              上一段
            </Button>
            <Button
              isDisabled={isLast}
              size="sm"
              variant="outline"
              onPress={() => goTo(index + 1, isPlaying)}
            >
              下一段
              <ChevronRight aria-hidden />
            </Button>
          </div>
        ) : null}
      </div>

      {!hasStarted ? (
        <p className="muted m-0 text-xs">
          点播放开始听力。{segments.length} 段录音会连着放完
          {canSeek ? '，中途可以拖动进度条。' : '，严格模式下不能拖动进度条，放完立刻交卷。'}
        </p>
      ) : isFinished ? (
        <p className="m-0 text-xs text-warning-soft-foreground">录音已全部播完。</p>
      ) : null}
    </div>
  )
}
