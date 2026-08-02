import { useCallback, useEffect, useRef, useState } from 'react'
import { SelectField } from '../components/ui/SelectField'
import { Link, useParams } from 'react-router'
import {
  getPodcast,
  savePodcastPosition,
  savePodcastPositionBeacon,
  updatePodcastLine,
} from '../api/podcasts'
import { getErrorMessage } from '../api/error'
import { usePageActive, usePageTitle } from '../components/layout/pageContext'
import { getStoredToken } from '../store/authStore'
import { getTokenizer, renderFuriganaHtml } from '../utils/furigana'
import type { Podcast } from '../types'
import { Button } from '@heroui/react'

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

// The two inline-edit textareas for fixing a wrong auto-caption.
const EDIT_BOX =
  'w-full resize-y rounded-lg border border-field-border bg-field px-2 py-1.5 font-[inherit] text-sm/[1.5] focus:border-accent focus:outline-none'

// keep-all stops CJK from breaking mid-word; anywhere still rescues long URLs.
const LINE_TEXT = 'text-[15px]/[1.6] [word-break:keep-all] [overflow-wrap:anywhere]'

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
  const isActive = usePageActive()
  const [title, setTitle] = useState<string | null>(null)
  usePageTitle(`/podcasts/${id}`, title)
  const [podcast, setPodcast] = useState<Podcast | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const [isPlaying, setIsPlaying] = useState(false)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [videoHidden, setVideoHidden] = useState(false)
  // Was-hidden tracking so we only re-seek on the hidden→shown transition,
  // not on every render.
  const wasHiddenRef = useRef(false)
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
  // Mutable mirrors so the poll timers, key handlers and the mp3 <audio>
  // ref-callback (attachMp3) — all stable across renders — can read the latest
  // values without being torn down and rebuilt on every change.
  //
  // `podcastRef` is written where the podcast is fetched, not after render:
  // attachMp3 runs during commit, i.e. before passive effects, so a mirror
  // updated in an effect would still read null the one time it matters.
  const podcastRef = useRef<Podcast | null>(null)
  const currentIdxRef = useRef(currentIdx)
  const playbackRateRef = useRef(playbackRate)
  useEffect(() => {
    currentIdxRef.current = currentIdx
    playbackRateRef.current = playbackRate
  })
  // Teardown (listeners + poll timer) for the currently-attached mp3 element.
  const mp3CleanupRef = useRef<null | (() => void)>(null)

  const podcastId = podcast?.id
  const primaryLang = podcast?.primaryLang

  useEffect(() => {
    if (!id) return
    let ignore = false
    async function load(podcastId: string) {
      setIsLoading(true)
      setError(null)
      try {
        const p = await getPodcast(podcastId)
        if (ignore) return
        setPodcast(p)
        podcastRef.current = p
        linesRef.current = p.transcript.lines
        setTitle(p.title ?? null)
      } catch (err) {
        if (!ignore) setError(getErrorMessage(err, '加载失败'))
      } finally {
        if (!ignore) setIsLoading(false)
      }
    }
    void load(id)
    return () => {
      ignore = true
    }
  }, [id])

  // Lazy-build per-line furigana for Japanese podcasts. ~12MB dict downloads
  // on first use, then a few hundred lines tokenize within ~1s.
  //
  // Keyed on the id, not the podcast object: editing a caption line makes a new
  // object, and re-tokenizing the whole transcript for one line would be
  // absurd — saveEditLine patches that single line's ruby instead. The lines
  // therefore come from `linesRef`, which the fetch keeps in step.
  useEffect(() => {
    if (!podcastId || primaryLang !== 'jp') return
    let cancelled = false
    const lines = linesRef.current
    async function buildFurigana() {
      setFuriganaState('loading')
      try {
        const tk = await getTokenizer()
        if (cancelled) return
        setFuriganaHtml(lines.map((ln) => renderFuriganaHtml(tk, ln.text)))
        setFuriganaState('ready')
      } catch {
        if (!cancelled) setFuriganaState('error')
      }
    }
    void buildFurigana()
    return () => {
      cancelled = true
    }
  }, [podcastId, primaryLang])

  // Initialize the player once we have the podcast. Mp3-based podcasts get an
  // HTMLAudioElement adapter; YouTube ones go through the iframe API.
  useEffect(() => {
    if (!podcast) return
    // MP3-backed podcasts wire their player imperatively via the <audio>
    // element's ref-callback (attachMp3) — it fires the instant the DOM node
    // mounts, with no dependence on effect / render timing. Nothing to do here.
    if (podcast.mp3Url) return

    let cancelled = false
    let pollTimer: number | null = null

    // ── YouTube path ──
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

  // Ref-callback for the mp3 <audio> element. Runs synchronously when React
  // mounts (node) or unmounts (null) the element — no effect/render-timing
  // dependence, which is what made the previous state-based wiring flaky (the
  // init effect could run before the node existed and never re-fire, leaving
  // playerRef null so the toolbar / seek did nothing).
  const attachMp3 = useCallback((el: HTMLAudioElement | null) => {
    // Tear down any previous attachment first.
    if (mp3CleanupRef.current) {
      mp3CleanupRef.current()
      mp3CleanupRef.current = null
    }
    if (!el) return
    const pod = podcastRef.current
    if (!pod) return

    el.playbackRate = playbackRateRef.current
    const saved = pod.lastPositionSec ?? 0
    const dur = pod.durationSec
    if (saved > 0 && (dur === 0 || saved < dur - 10)) {
      el.currentTime = saved
    }

    // Adapter — makes the <audio> quack like a YTPlayer so the toolbar,
    // hotkeys and seek logic stay agnostic of the backend.
    const adapter: YTPlayer = {
      playVideo: () => { void el.play() },
      pauseVideo: () => el.pause(),
      seekTo: (sec: number) => { el.currentTime = sec },
      getCurrentTime: () => el.currentTime,
      getPlayerState: () => (el.paused ? 2 : 1), // 2=paused, 1=playing (YT enum)
      setPlaybackRate: (rate: number) => { el.playbackRate = rate },
      destroy: () => { el.pause() },
    }
    playerRef.current = adapter

    const onPlay = () => setIsPlaying(true)
    const onPause = () => {
      setIsPlaying(false)
      if (el.currentTime > 5) {
        void savePodcastPosition(pod.id, el.currentTime).catch(() => {})
      }
    }
    const onEnded = () => {
      setIsPlaying(false)
      void savePodcastPosition(pod.id, 0).catch(() => {})
    }
    el.addEventListener('play', onPlay)
    el.addEventListener('pause', onPause)
    el.addEventListener('ended', onEnded)

    // Poll current time → highlight current line + persist position.
    let lastSavedAt = 0
    const pollTimer = window.setInterval(() => {
      const sec = el.currentTime
      const ms = sec * 1000
      if (!isScrubbingRef.current) setCurrentSec(sec)
      const lines = linesRef.current
      let next = -1
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].start <= ms) next = i
        else break
      }
      if (next !== currentIdxRef.current) setCurrentIdx(next)
      const now = Date.now()
      if (sec > 5 && now - lastSavedAt > 5000) {
        void savePodcastPosition(pod.id, sec).catch(() => {})
        lastSavedAt = now
      }
    }, 250)

    mp3CleanupRef.current = () => {
      window.clearInterval(pollTimer)
      try {
        if (el.currentTime > 5) {
          savePodcastPositionBeacon(pod.id, el.currentTime, getStoredToken())
        }
      } catch {
        // best-effort on teardown — a failed beacon must not break unmount
      }
      el.removeEventListener('play', onPlay)
      el.removeEventListener('pause', onPause)
      el.removeEventListener('ended', onEnded)
      playerRef.current = null
    }
    // Deps intentionally empty: all values read via stable refs so the
    // callback identity never changes (React would otherwise re-run it,
    // tearing down + rebuilding the player on every render).
  }, [])

  // Persist position when the user navigates away / closes the tab — the
  // component cleanup isn't guaranteed to run in those cases. Use the
  // keepalive fetch so the request survives the page going away.
  useEffect(() => {
    if (!podcastId) return
    const persist = () => {
      try {
        const sec = playerRef.current?.getCurrentTime() ?? 0
        if (sec > 5) {
          savePodcastPositionBeacon(podcastId, sec, getStoredToken())
        }
      } catch {
        // player already torn down — nothing left to persist
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
  }, [podcastId])

  // Push rate changes into the player.
  useEffect(() => {
    if (!playerRef.current) return
    try {
      playerRef.current.setPlaybackRate(playbackRate)
    } catch {
      // ignore
    }
  }, [playbackRate])

  // Fix "black screen with 更多视频 overlay after re-showing" — YouTube iframe
  // enters a stale state when its container was `display: none`. Re-seeking
  // to the last known playhead forces YouTube to re-render the video frame
  // and drops the "related videos" overlay. Only fire on hidden→shown edge.
  useEffect(() => {
    if (wasHiddenRef.current && !videoHidden) {
      const player = playerRef.current
      if (player) {
        try {
          const sec = player.getCurrentTime()
          // seekTo with allowSeekAhead=true forces a network reload of that
          // segment; the small +0.001 is a nudge that some browsers need
          // (identical seekTo can be no-op'd by YouTube).
          player.seekTo(sec + 0.001, true)
        } catch {
          // ignore
        }
      }
    }
    wasHiddenRef.current = videoHidden
  }, [videoHidden])

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
      const base = podcastRef.current ?? podcast
      const nextLines = base.transcript.lines.map((ln, i) =>
        i === editingIdx ? { ...ln, text: updated.text, zh: updated.zh } : ln,
      )
      const nextPodcast = {
        ...base,
        transcript: { ...base.transcript, lines: nextLines },
      }
      setPodcast(nextPodcast)
      podcastRef.current = nextPodcast
      linesRef.current = nextLines
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
    // Compare with the raw YT.PlayerState.PLAYING value (1) instead of
    // `window.YT.PlayerState.PLAYING` — mp3 podcasts never load the YouTube
    // API, so `window.YT` is undefined and the old code always fell through
    // to `else`, making the play button a no-op after start.
    const isPlayingNow = player.getPlayerState() === 1
    if (isPlayingNow) player.pauseVideo()
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
    // pb-24 leaves room for the fixed bottom toolbar.
    <section className="page pb-24">
      <div className="section-header">
        <div>
          <h2>{podcast.title}</h2>
          <p className="muted">
            {podcast.primaryLang.toUpperCase()} · {lines.length} 句
            {podcast.transcript.chineseTrack ? ' · 含中文字幕' : ''}
          </p>
        </div>
      </div>

      {/* Keep the iframe MOUNTED even when "hidden" — display:none causes
        * YouTube to freeze the iframe and it wakes up in a stale "ended"
        * state (with 更多视频 overlay). Instead we zero out the visual
        * footprint so the iframe stays alive in the background. */}
      <div
        className="card sticky top-3 z-20 flex justify-center overflow-hidden p-3 shadow-overlay"
        style={
          videoHidden
            ? {
                position: 'absolute',
                visibility: 'hidden',
                pointerEvents: 'none',
                width: 1,
                height: 1,
                overflow: 'hidden',
                boxShadow: 'none',
              }
            : undefined
        }
        aria-hidden={videoHidden}
      >
        <button
          type="button"
          className="absolute top-1.5 right-1.5 z-[2] inline-flex size-7 min-h-0 cursor-pointer items-center justify-center rounded-full border-none p-0 text-sm leading-none text-background bg-foreground/60 transition-colors duration-150 hover:bg-foreground/85"
          onClick={() => setVideoHidden(true)}
          aria-label="收起视频"
          title="收起视频"
        >
          ✕
        </button>
        {/* The YouTube API injects its iframe into the empty div below, so both
          * the placeholder and the injected frame get the same fill rules. */}
        <div className="relative aspect-video w-full max-w-[560px] overflow-hidden rounded-xl [&>div]:absolute [&>div]:inset-0 [&>div]:size-full [&_iframe]:absolute [&_iframe]:inset-0 [&_iframe]:size-full [&_iframe]:border-0">
          {podcast?.mp3Url ? (
            <audio
              // Imperative ref-callback — wires the adapter + polling the
              // instant the node mounts (see attachMp3). Robust against the
              // effect / render-timing races the old state-based ref had.
              ref={attachMp3}
              src={podcast.mp3Url}
              controls
              preload="metadata"
              className="block h-11 w-full"
            />
          ) : (
            <div ref={playerHostRef} />
          )}
        </div>
      </div>
      {videoHidden ? (
        <button
          type="button"
          className="fixed top-[72px] right-5 z-[15] cursor-pointer rounded-full border-none bg-accent px-3.5 py-2 text-[13px] font-medium text-accent-foreground shadow-[0_4px_12px_-4px_var(--accent)] transition-[background-color,transform] duration-150 hover:-translate-y-px hover:bg-accent-hover"
          onClick={() => setVideoHidden(false)}
          title="显示视频"
        >
          ▶ 视频
        </button>
      ) : null}

      <div className="card flex flex-col gap-1">
        {lines.map((ln, idx) => {
          const isActive = idx === currentIdx
          const isEditing = editingIdx === idx
          return (
            <div
              key={idx}
              id={`podcast-line-${idx}`}
              className={`group relative flex items-start gap-3 rounded-[10px] py-2 pr-[38px] pl-2.5 transition-colors duration-150 ${
                isEditing
                  ? 'cursor-default bg-accent-soft'
                  : `cursor-pointer hover:bg-surface-secondary ${isActive ? 'bg-accent-soft' : ''}`
              }`}
              onClick={() => {
                // Don't seek while editing — the user is trying to interact
                // with the form, not jump elsewhere.
                if (isEditing) return
                seekToLine(idx)
              }}
              role="button"
              tabIndex={0}
            >
              {/* line-height matches the body text's first line, so 7:59 sits on
                * the same baseline as 復旧に despite the smaller font. */}
              <div className="w-12 shrink-0 text-xs/[24px] tabular-nums text-muted">
                {formatTime(ln.start)}
              </div>
              <div className="min-w-0 flex-1">
                {isEditing ? (
                  <div className="grid gap-2" onClick={(e) => e.stopPropagation()}>
                    <textarea
                      className={EDIT_BOX}
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      rows={2}
                      autoFocus
                      placeholder="字幕原文"
                    />
                    <textarea
                      className={`${EDIT_BOX} text-[13px] text-muted`}
                      value={editZh}
                      onChange={(e) => setEditZh(e.target.value)}
                      rows={2}
                      placeholder="中文翻译（可留空）"
                    />
                    <div className="mt-0.5 flex gap-2">
                      <Button className="text-[13px]"
                        type="button"
                        onPress={() => void saveEditLine()}
                        isDisabled={isSavingEdit}
                      >
                        {isSavingEdit ? '保存中…' : '保存'}
                      </Button>
                      <Button variant="outline" size="sm" className="text-[13px]"
                        type="button"
                        onPress={cancelEditLine}
                        isDisabled={isSavingEdit}
                      >
                        取消
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    {showFurigana && furiganaHtml[idx] ? (
                      <div
                        className={`furigana-text ${LINE_TEXT} ${isActive ? 'font-semibold' : ''}`}
                        dangerouslySetInnerHTML={{ __html: furiganaHtml[idx] }}
                      />
                    ) : (
                      <div className={`${LINE_TEXT} ${isActive ? 'font-semibold' : ''}`}>
                        {ln.text}
                      </div>
                    )}
                    {ln.zh ? (
                      <div className="muted mt-0.5 text-[13px]/[1.5]">{ln.zh}</div>
                    ) : null}
                  </>
                )}
              </div>
              {!isEditing ? (
                <button
                  type="button"
                  className="absolute top-0 right-2 inline-flex h-[18px] w-[22px] min-h-0 cursor-pointer items-center justify-center rounded-md border-none bg-transparent p-0 text-xs leading-none text-muted opacity-0 transition-[opacity,background-color,color] duration-150 group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-foreground/8 hover:text-foreground"
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

      <div className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-overlay py-2 pr-3.5 pl-2 text-[13px] whitespace-nowrap shadow-overlay [&>*]:shrink-0 [&>*]:whitespace-nowrap max-sm:gap-1.5 max-sm:py-1.5 max-sm:pr-2.5 max-sm:pl-1.5">
        <button
          type="button"
          className="inline-flex size-10 min-h-0 cursor-pointer items-center justify-center rounded-full border-none bg-accent p-0 text-sm leading-none text-accent-foreground transition-[filter] duration-150 hover:brightness-110 active:scale-[0.96]"
          onClick={togglePlay}
          aria-label={isPlaying ? '暂停' : '播放'}
          title={isPlaying ? '暂停 (Space)' : '播放 (Space)'}
        >
          <span aria-hidden>{isPlaying ? '❚❚' : '▶'}</span>
        </button>

        <span className="min-w-9 text-center text-xs tabular-nums text-muted">{formatTime(currentSec * 1000)}</span>
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
        <span className="min-w-9 text-center text-xs tabular-nums text-muted">{formatTime(podcast.durationSec * 1000)}</span>

        <SelectField
          className="min-w-[80px]"
          value={playbackRate}
          onChange={(v) => setPlaybackRate(Number(v))}
          aria-label="播放速度"
          options={SPEEDS.map((s) => ({ value: s, label: `${s}x` }))}
        />

        <button
          type="button"
          className={`h-8 min-h-0 cursor-pointer rounded-full border px-3.5 text-[13px] font-medium disabled:cursor-not-allowed disabled:opacity-45 ${
            videoHidden
              ? 'border-border bg-surface text-muted hover:bg-foreground/4'
              : 'border-accent/25 bg-accent/10 text-accent'
          }`}
          onClick={() => setVideoHidden((v) => !v)}
          title={videoHidden ? '显示视频' : '隐藏视频'}
        >
          视频
        </button>

        {podcast.primaryLang === 'jp' ? (
          <button
            type="button"
            className={`h-8 min-h-0 cursor-pointer rounded-full border px-3.5 text-[13px] font-medium disabled:cursor-not-allowed disabled:opacity-45 ${
              showFurigana
                ? 'border-accent/25 bg-accent/10 text-accent'
                : 'border-border bg-surface text-muted not-disabled:hover:bg-foreground/4'
            }`}
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

        <span className="ml-1 inline-flex items-center gap-[3px] border-l border-border pl-2 text-[11px] text-muted [&>kbd]:inline-flex [&>kbd]:h-[18px] [&>kbd]:min-w-[18px] [&>kbd]:items-center [&>kbd]:justify-center [&>kbd]:rounded [&>kbd]:border [&>kbd]:border-border [&>kbd]:bg-foreground/6 [&>kbd]:px-1 [&>kbd]:font-[inherit] [&>kbd]:text-[11px]/none [&>kbd]:text-muted max-sm:hidden">
          <kbd>←</kbd><kbd>→</kbd>切句<span className="mx-1 text-foreground/25">·</span>
          <kbd>Space</kbd>播放
        </span>
      </div>
    </section>
  )
}
