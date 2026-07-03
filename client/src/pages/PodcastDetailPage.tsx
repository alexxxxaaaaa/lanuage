import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  getPodcast,
  savePodcastPosition,
  savePodcastPositionBeacon,
  updatePodcastLine,
} from '../api/podcasts'
import { getErrorMessage } from '../api/error'
import { useTab } from '../components/TabContext'
import { getStoredToken } from '../store/authStore'
import { getTokenizer, renderFuriganaHtml } from '../utils/furigana'
import type { Podcast } from '../types'

// Minimal YouTube IFrame Player types — pulled in just for the methods we use.
type YTPlayer = {
  playVideo(): void
  pauseVideo(): void
  seekTo(sec: number, allow: boolean): void
  getCurrentTime(): number
  getPlayerState(): number
  setPlaybackRate(rate: number): void
  destroy(): void
}

declare global {
  interface Window {
    YT?: {
      Player: new (
        el: HTMLElement | string,
        opts: {
          height?: number | string
          width?: number | string
          videoId: string
          playerVars?: Record<string, string | number>
          events?: {
            onReady?: (e: { target: YTPlayer }) => void
            onStateChange?: (e: { data: number; target: YTPlayer }) => void
          }
        },
      ) => YTPlayer
      PlayerState: { ENDED: 0; PLAYING: 1; PAUSED: 2; BUFFERING: 3; CUED: 5 }
    }
    onYouTubeIframeAPIReady?: () => void
  }
}

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2]

let apiLoadPromise: Promise<void> | null = null
function loadYouTubeApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve()
  if (apiLoadPromise) return apiLoadPromise
  apiLoadPromise = new Promise<void>((resolve) => {
    const prev = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      prev?.()
      resolve()
    }
    const tag = document.createElement('script')
    tag.src = 'https://www.youtube.com/iframe_api'
    document.body.appendChild(tag)
  })
  return apiLoadPromise
}

function formatTime(ms: number) {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function PodcastDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { setTitle, isActive } = useTab()
  const [podcast, setPodcast] = useState<Podcast | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const [isPlaying, setIsPlaying] = useState(false)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [videoHidden, setVideoHidden] = useState(false)
  const [currentIdx, setCurrentIdx] = useState(-1)
  const [currentSec, setCurrentSec] = useState(0)
  const isScrubbingRef = useRef(false)
  // Per-line HTML with <ruby> furigana annotations. Built lazily for JP only.
  const [furiganaHtml, setFuriganaHtml] = useState<string[]>([])
  const [furiganaState, setFuriganaState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [showFurigana, setShowFurigana] = useState(true)
  // Inline-edit state for fixing wrong auto-captions. Only one line can be
  // edited at a time — entering edit mode cancels any other in-progress edit.
  const [editingIdx, setEditingIdx] = useState<number | null>(null)
  const [editText, setEditText] = useState('')
  const [editZh, setEditZh] = useState('')
  const [isSavingEdit, setIsSavingEdit] = useState(false)

  const playerRef = useRef<YTPlayer | null>(null)
  const playerHostRef = useRef<HTMLDivElement | null>(null)
  const linesRef = useRef<Podcast['transcript']['lines']>([])
  const currentIdxRef = useRef(currentIdx)
  currentIdxRef.current = currentIdx

  useEffect(() => {
    if (!id) return
    setIsLoading(true)
    setError(null)
    void getPodcast(id)
      .then((p) => {
        setPodcast(p)
        linesRef.current = p.transcript.lines
        if (p.title) setTitle(p.title)
      })
      .catch((err) => setError(getErrorMessage(err, '加载失败')))
      .finally(() => setIsLoading(false))
    // setTitle is stable across renders (tabId-scoped); excluding it keeps the
    // effect from re-running when the active tab changes (which would re-fetch).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // Lazy-build per-line furigana for Japanese podcasts. ~12MB dict downloads
  // on first use, then a few hundred lines tokenize within ~1s.
  useEffect(() => {
    if (!podcast || podcast.primaryLang !== 'jp') return
    let cancelled = false
    setFuriganaState('loading')
    void getTokenizer()
      .then((tk) => {
        if (cancelled) return
        const html = podcast.transcript.lines.map((ln) =>
          renderFuriganaHtml(tk, ln.text),
        )
        if (cancelled) return
        setFuriganaHtml(html)
        setFuriganaState('ready')
      })
      .catch(() => {
        if (!cancelled) setFuriganaState('error')
      })
    return () => {
      cancelled = true
    }
  }, [podcast?.id, podcast?.primaryLang])

  // Initialize the YT player once we have the podcast.
  useEffect(() => {
    if (!podcast) return
    let cancelled = false
    let pollTimer: number | null = null
    void loadYouTubeApi().then(() => {
      if (cancelled || !playerHostRef.current || !window.YT) return
      const player = new window.YT.Player(playerHostRef.current, {
        videoId: podcast.youtubeId,
        height: '100%',
        width: '100%',
        playerVars: {
          modestbranding: 1,
          rel: 0,
          playsinline: 1,
        },
        events: {
          onReady: ({ target }) => {
            playerRef.current = target
            target.setPlaybackRate(playbackRate)
            // Restore last position from server data. Skip if within 10s of
            // the end (already finished) — otherwise resume loops the outro.
            const saved = podcast.lastPositionSec ?? 0
            const dur = podcast.durationSec
            if (saved > 0 && (dur === 0 || saved < dur - 10)) {
              try {
                target.seekTo(saved, true)
              } catch {
                // ignore
              }
            }
            // Poll current time → highlight current line + persist position.
            let lastSavedAt = 0
            pollTimer = window.setInterval(() => {
              const sec = target.getCurrentTime()
              const ms = sec * 1000
              // Don't fight the slider while the user is dragging it.
              if (!isScrubbingRef.current) setCurrentSec(sec)
              const lines = linesRef.current
              // Find the last line whose start has been reached. Tracking by
              // [start, start+dur) misses inter-line gaps (the silence between
              // sentences) and would flip currentIdx to -1, which made the
              // "previous sentence" hotkey rewind to the very beginning.
              let next = -1
              for (let i = 0; i < lines.length; i++) {
                if (lines[i].start <= ms) next = i
                else break
              }
              if (next !== currentIdxRef.current) {
                setCurrentIdx(next)
              }
              // Throttle PATCH to once every 5s during playback.
              const now = Date.now()
              if (sec > 5 && now - lastSavedAt > 5000) {
                void savePodcastPosition(podcast.id, sec).catch(() => {})
                lastSavedAt = now
              }
            }, 250)
          },
          onStateChange: ({ data }) => {
            const PS = window.YT?.PlayerState
            if (!PS) return
            if (data === PS.PLAYING) setIsPlaying(true)
            else if (data === PS.PAUSED || data === PS.ENDED) setIsPlaying(false)
            // Persist position on pause / end too, so closing the tab right
            // after pausing still preserves the spot.
            if (data === PS.PAUSED || data === PS.ENDED) {
              try {
                const sec = playerRef.current?.getCurrentTime() ?? 0
                if (data === PS.ENDED) {
                  // Watched to the end — reset to 0 so next time starts fresh.
                  void savePodcastPosition(podcast.id, 0).catch(() => {})
                } else if (sec > 5) {
                  void savePodcastPosition(podcast.id, sec).catch(() => {})
                }
              } catch {
                // ignore
              }
            }
          },
        },
      })
      playerRef.current = player
    })
    return () => {
      cancelled = true
      if (pollTimer !== null) window.clearInterval(pollTimer)
      // One last position-save via keepalive fetch so it survives unmount /
      // navigation (axios requests get cancelled mid-flight in that path).
      try {
        const sec = playerRef.current?.getCurrentTime() ?? 0
        if (sec > 5) {
          savePodcastPositionBeacon(podcast.id, sec, getStoredToken())
        }
      } catch {
        // ignore
      }
      try {
        playerRef.current?.destroy()
      } catch {
        // Ignore — already destroyed.
      }
      playerRef.current = null
    }
    // playbackRate intentionally not in deps — first-load value only; later
    // changes go through the separate setPlaybackRate effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [podcast?.youtubeId])

  // Persist position when the user navigates away / closes the tab — the
  // component cleanup isn't guaranteed to run in those cases. Use the
  // keepalive fetch so the request survives the page going away.
  useEffect(() => {
    if (!podcast) return
    const persist = () => {
      try {
        const sec = playerRef.current?.getCurrentTime() ?? 0
        if (sec > 5) {
          savePodcastPositionBeacon(podcast.id, sec, getStoredToken())
        }
      } catch {
        // ignore
      }
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') persist()
    }
    window.addEventListener('beforeunload', persist)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('beforeunload', persist)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [podcast?.id])

  // Push rate changes into the player.
  useEffect(() => {
    if (!playerRef.current) return
    try {
      playerRef.current.setPlaybackRate(playbackRate)
    } catch {
      // ignore
    }
  }, [playbackRate])

  const beginEditLine = (idx: number) => {
    if (!podcast) return
    const ln = podcast.transcript.lines[idx]
    if (!ln) return
    setEditingIdx(idx)
    setEditText(ln.text ?? '')
    setEditZh(ln.zh ?? '')
  }

  const cancelEditLine = () => {
    setEditingIdx(null)
    setEditText('')
    setEditZh('')
  }

  const saveEditLine = async () => {
    if (editingIdx === null || !podcast || !id) return
    const original = podcast.transcript.lines[editingIdx]
    if (!original) return
    const nextText = editText
    const nextZh = editZh.trim() === '' ? null : editZh
    // Nothing actually changed → just close.
    if (nextText === original.text && (nextZh ?? null) === (original.zh ?? null)) {
      cancelEditLine()
      return
    }

    setIsSavingEdit(true)
    try {
      const updated = await updatePodcastLine(id, editingIdx, {
        text: nextText,
        zh: nextZh,
      })
      // Patch the local podcast object so the rendered list updates without
      // a full refetch. Keep all other lines intact.
      setPodcast((prev) => {
        if (!prev) return prev
        const nextLines = prev.transcript.lines.map((ln, i) =>
          i === editingIdx ? { ...ln, text: updated.text, zh: updated.zh } : ln,
        )
        return { ...prev, transcript: { ...prev.transcript, lines: nextLines } }
      })
      // If this is a JP podcast and furigana is already loaded, recompute
      // furigana HTML for just this line so the ruby annotations don't go
      // stale. Fire and forget — failure just means this one line falls back
      // to plain text on next render.
      if (podcast.primaryLang === 'jp' && furiganaState === 'ready') {
        void getTokenizer().then((tk) => {
          const html = renderFuriganaHtml(tk, updated.text)
          setFuriganaHtml((prev) => {
            const next = prev.slice()
            next[editingIdx] = html
            return next
          })
        })
      }
      cancelEditLine()
    } catch {
      // Leave the edit panel open so the user can retry. Don't trash their text.
    } finally {
      setIsSavingEdit(false)
    }
  }

  const seekToLine = (idx: number) => {
    if (!podcast) return
    const lines = podcast.transcript.lines
    if (idx < 0 || idx >= lines.length) return
    const startSec = lines[idx].start / 1000
    const player = playerRef.current
    if (!player) return
    // Only seek — don't force playVideo(). YouTube IFrame preserves the
    // current play/pause state across seekTo, which is what we want:
    // clicking a line while paused stays paused at the new position;
    // clicking while playing continues playing from there.
    player.seekTo(startSec, true)
    setCurrentIdx(idx)
  }

  const togglePlay = () => {
    const player = playerRef.current
    if (!player) return
    const PS = window.YT?.PlayerState
    const state = player.getPlayerState()
    if (state === PS?.PLAYING) player.pauseVideo()
    else player.playVideo()
  }

  // Keyboard: Space → play/pause, ← / → → prev/next sentence. Gated on
  // isActive so hotkeys don't fire while the podcast tab is hidden — without
  // this, pressing Space while viewing a folder/search tab toggles podcast
  // play because the listener is on window.
  useEffect(() => {
    if (!podcast || !isActive) return
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const tag = target?.tagName ?? ''
      if (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        (target?.isContentEditable ?? false)
      ) {
        return
      }
      if (e.key === ' ') {
        e.preventDefault()
        togglePlay()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        seekToLine(Math.max(0, currentIdxRef.current + 1))
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        seekToLine(Math.max(0, currentIdxRef.current - 1))
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [podcast?.youtubeId, isActive])

  // Auto-scroll active line into view. Re-fires when the tab regains focus
  // so the user lands back on the current line instead of "the top" — which
  // is misleading because scroll position on this page is driven entirely by
  // scrollIntoView (the user never actually scrolls window themselves).
  // On re-activation we snap (instant) so there's no jarring smooth scroll
  // from 0; during playback we keep smooth following.
  const wasActiveRef = useRef(isActive)
  useEffect(() => {
    if (!isActive) {
      wasActiveRef.current = false
      return
    }
    if (currentIdx < 0) return
    const el = document.getElementById(`podcast-line-${currentIdx}`)
    if (!el) return
    const behavior: ScrollBehavior = wasActiveRef.current ? 'smooth' : 'instant'
    wasActiveRef.current = true
    el.scrollIntoView({ behavior, block: 'center' })
  }, [currentIdx, isActive])

  if (isLoading) {
    return <section className="page"><div className="card">加载中...</div></section>
  }
  if (!podcast) {
    return (
      <section className="page">
        <div className="card">
          {error ?? '没找到该播客'}
          <p><Link to="/podcasts">返回列表</Link></p>
        </div>
      </section>
    )
  }

  const lines = podcast.transcript.lines

  return (
    <section className="page podcast-detail">
      <div className="section-header">
        <div>
          <p className="eyebrow"><Link to="/podcasts">播客</Link></p>
          <h2>{podcast.title}</h2>
          <p className="muted">
            {podcast.primaryLang.toUpperCase()} · {lines.length} 句
            {podcast.transcript.chineseTrack ? ' · 含中文字幕' : ''}
          </p>
        </div>
      </div>

      <div
        className="card podcast-player-card"
        style={{ display: videoHidden ? 'none' : undefined }}
      >
        <div className="podcast-player-frame">
          <div ref={playerHostRef} />
        </div>
      </div>

      <div className="card podcast-transcript">
        {lines.map((ln, idx) => {
          const isActive = idx === currentIdx
          const isEditing = editingIdx === idx
          return (
            <div
              key={idx}
              id={`podcast-line-${idx}`}
              className={`podcast-line${isActive ? ' is-active' : ''}${isEditing ? ' is-editing' : ''}`}
              onClick={() => {
                // Don't seek while editing — the user is trying to interact
                // with the form, not jump elsewhere.
                if (isEditing) return
                seekToLine(idx)
              }}
              role="button"
              tabIndex={0}
            >
              <div className="podcast-line-time">{formatTime(ln.start)}</div>
              <div className="podcast-line-body">
                {isEditing ? (
                  <div
                    className="podcast-line-edit"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <textarea
                      className="podcast-line-edit-text"
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      rows={2}
                      autoFocus
                      placeholder="字幕原文"
                    />
                    <textarea
                      className="podcast-line-edit-zh"
                      value={editZh}
                      onChange={(e) => setEditZh(e.target.value)}
                      rows={2}
                      placeholder="中文翻译（可留空）"
                    />
                    <div className="podcast-line-edit-actions">
                      <button
                        type="button"
                        className="primary-button"
                        onClick={() => void saveEditLine()}
                        disabled={isSavingEdit}
                      >
                        {isSavingEdit ? '保存中…' : '保存'}
                      </button>
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={cancelEditLine}
                        disabled={isSavingEdit}
                      >
                        取消
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {showFurigana && furiganaHtml[idx] ? (
                      <div
                        className="podcast-line-text"
                        dangerouslySetInnerHTML={{ __html: furiganaHtml[idx] }}
                      />
                    ) : (
                      <div className="podcast-line-text">{ln.text}</div>
                    )}
                    {ln.zh ? (
                      <div className="podcast-line-zh muted">{ln.zh}</div>
                    ) : null}
                  </>
                )}
              </div>
              {!isEditing ? (
                <button
                  type="button"
                  className="podcast-line-edit-btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    beginEditLine(idx)
                  }}
                  title="修改这一句"
                  aria-label="修改这一句"
                >
                  ✎
                </button>
              ) : null}
            </div>
          )
        })}
      </div>

      <div className="podcast-toolbar">
        <button
          type="button"
          className="podcast-play"
          onClick={togglePlay}
          aria-label={isPlaying ? '暂停' : '播放'}
          title={isPlaying ? '暂停 (Space)' : '播放 (Space)'}
        >
          <span aria-hidden>{isPlaying ? '❚❚' : '▶'}</span>
        </button>

        <span className="podcast-time">{formatTime(currentSec * 1000)}</span>
        <input
          type="range"
          className="podcast-progress"
          min={0}
          max={Math.max(1, podcast.durationSec)}
          step={1}
          value={Math.min(currentSec, podcast.durationSec)}
          onPointerDown={() => {
            isScrubbingRef.current = true
          }}
          onChange={(e) => {
            // Track local state during drag so the thumb moves smoothly.
            setCurrentSec(Number(e.target.value))
          }}
          onPointerUp={(e) => {
            const target = e.currentTarget as HTMLInputElement
            const sec = Number(target.value)
            playerRef.current?.seekTo(sec, true)
            // Update current line right away so transcript highlight follows.
            const ms = sec * 1000
            const lines = linesRef.current
            let next = -1
            for (let i = 0; i < lines.length; i++) {
              if (lines[i].start <= ms) next = i
              else break
            }
            if (next !== currentIdxRef.current) setCurrentIdx(next)
            isScrubbingRef.current = false
          }}
          aria-label="进度"
        />
        <span className="podcast-time">{formatTime(podcast.durationSec * 1000)}</span>

        <select
          className="podcast-speed"
          value={playbackRate}
          onChange={(e) => setPlaybackRate(Number(e.target.value))}
          aria-label="播放速度"
          title="播放速度"
        >
          {SPEEDS.map((s) => (
            <option key={s} value={s}>{s}x</option>
          ))}
        </select>

        <button
          type="button"
          className={`podcast-chip${videoHidden ? '' : ' is-on'}`}
          onClick={() => setVideoHidden((v) => !v)}
          title={videoHidden ? '显示视频' : '隐藏视频'}
        >
          视频
        </button>

        {podcast.primaryLang === 'jp' ? (
          <button
            type="button"
            className={`podcast-chip${showFurigana ? ' is-on' : ''}`}
            onClick={() => setShowFurigana((v) => !v)}
            disabled={furiganaState === 'loading'}
            title={
              furiganaState === 'loading'
                ? '正在加载假名词典(首次)…'
                : furiganaState === 'error'
                  ? '假名词典加载失败'
                  : showFurigana
                    ? '隐藏假名'
                    : '显示假名'
            }
          >
            {furiganaState === 'loading' ? '加载中' : '假名'}
          </button>
        ) : null}

        <span className="podcast-toolbar-hint">
          <kbd>←</kbd><kbd>→</kbd>切句<span className="podcast-toolbar-dot">·</span>
          <kbd>Space</kbd>播放
        </span>
      </div>
    </section>
  )
}
