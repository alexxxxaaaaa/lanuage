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

// The cue before and after the active one, dimmed. Rendered even when absent
// (as &nbsp;) so the three-line block keeps a constant height.
const NEIGHBOR = 'muted m-0 min-h-5 text-[0.85rem]/[1.4]'

// Sticky-top audio player. Fetches SRT once, then binds an interval to
// audio.currentTime to highlight the active cue.
export function ExamAudioPlayer({ audioUrl, subtitleUrl }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [subtitles, setSubtitles] = useState<SubtitleLine[]>([])
  const [currentMs, setCurrentMs] = useState(0)

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
    audio.addEventListener('timeupdate', onTime)
    return () => audio.removeEventListener('timeupdate', onTime)
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
    <div className="flex flex-col gap-2 rounded-[10px] border border-black/8 bg-neutral-50 px-3 py-2">
      <audio
        ref={audioRef}
        src={audioUrl}
        controls
        preload="metadata"
        className="h-9 w-full"
      />
      {subtitles.length > 0 ? (
        <div className="flex min-h-[68px] flex-col gap-0.5 text-center">
          {prev ? (
            <p className={NEIGHBOR}>{prev.text}</p>
          ) : (
            <p className={NEIGHBOR}>&nbsp;</p>
          )}
          <p className="m-0 min-h-[26px] text-[1.05rem]/[1.5] font-semibold text-neutral-900 transition-colors duration-150">
            {active ? active.text : '（音声再生中…）'}
          </p>
          {next ? (
            <p className={NEIGHBOR}>{next.text}</p>
          ) : (
            <p className={NEIGHBOR}>&nbsp;</p>
          )}
        </div>
      ) : subtitleUrl ? (
        <p className="muted" style={{ margin: 0 }}>字幕加载中…</p>
      ) : null}
    </div>
  )
}
