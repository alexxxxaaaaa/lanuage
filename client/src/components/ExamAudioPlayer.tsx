import { useEffect, useMemo, useRef, useState } from 'react'
import type { SubtitleLine } from '../types'

type Props = {
  audioUrl: string
  subtitleUrl?: string
}

// Parse a standard SRT string into an array of {startMs, endMs, text}. Malformed
// blocks are skipped rather than aborting the whole track.
function parseSrt(raw: string): SubtitleLine[] {
  const lines: SubtitleLine[] = []
  const blocks = raw.replace(/\r/g, '').split(/\n\n+/)
  const tsRe =
    /(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/
  for (const block of blocks) {
    const rows = block.trim().split('\n')
    if (rows.length < 2) continue
    // Discard optional numeric index; find the first row matching a timestamp.
    const tsRow = rows.find((r) => tsRe.test(r))
    if (!tsRow) continue
    const m = tsRow.match(tsRe)!
    const toMs = (h: string, mi: string, s: string, ms: string) =>
      (+h) * 3_600_000 + (+mi) * 60_000 + (+s) * 1_000 + (+ms)
    const startMs = toMs(m[1], m[2], m[3], m[4])
    const endMs = toMs(m[5], m[6], m[7], m[8])
    const textRows = rows.slice(rows.indexOf(tsRow) + 1)
    const text = textRows.join('\n').trim()
    if (!text) continue
    lines.push({ startMs, endMs, text })
  }
  return lines
}

// Sticky-top audio player. Fetches SRT once, then binds an interval to
// audio.currentTime to highlight the active cue.
export function ExamAudioPlayer({ audioUrl, subtitleUrl }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [subtitles, setSubtitles] = useState<SubtitleLine[]>([])
  const [currentMs, setCurrentMs] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)

  useEffect(() => {
    if (!subtitleUrl) return
    let cancelled = false
    fetch(subtitleUrl)
      .then((r) => r.text())
      .then((raw) => {
        if (cancelled) return
        setSubtitles(parseSrt(raw))
      })
      .catch(() => {
        // Silently disable subtitles if fetch fails — audio still plays.
      })
    return () => {
      cancelled = true
    }
  }, [subtitleUrl])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    const onTime = () => setCurrentMs(audio.currentTime * 1000)
    const onPlay = () => setIsPlaying(true)
    const onPause = () => setIsPlaying(false)
    audio.addEventListener('timeupdate', onTime)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('ended', onPause)
    return () => {
      audio.removeEventListener('timeupdate', onTime)
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('ended', onPause)
    }
  }, [])

  const activeIdx = useMemo(() => {
    // Binary search would be faster but N is ~800 — linear is fine.
    for (let i = 0; i < subtitles.length; i++) {
      if (currentMs >= subtitles[i].startMs && currentMs <= subtitles[i].endMs) {
        return i
      }
    }
    return -1
  }, [subtitles, currentMs])

  const active = activeIdx >= 0 ? subtitles[activeIdx] : null
  const prev = activeIdx > 0 ? subtitles[activeIdx - 1] : null
  const next =
    activeIdx >= 0 && activeIdx < subtitles.length - 1
      ? subtitles[activeIdx + 1]
      : null

  return (
    <div className="exam-audio-player">
      <audio
        ref={audioRef}
        src={audioUrl}
        controls
        preload="metadata"
        className="exam-audio-player-audio"
      />
      {subtitles.length > 0 ? (
        <div className={'exam-audio-subs' + (isPlaying ? ' is-playing' : '')}>
          {prev ? (
            <p className="exam-audio-subs-neighbor muted">{prev.text}</p>
          ) : (
            <p className="exam-audio-subs-neighbor muted">&nbsp;</p>
          )}
          <p className="exam-audio-subs-active">
            {active ? active.text : '（音声再生中…）'}
          </p>
          {next ? (
            <p className="exam-audio-subs-neighbor muted">{next.text}</p>
          ) : (
            <p className="exam-audio-subs-neighbor muted">&nbsp;</p>
          )}
        </div>
      ) : subtitleUrl ? (
        <p className="muted" style={{ margin: 0 }}>字幕加载中…</p>
      ) : null}
    </div>
  )
}
