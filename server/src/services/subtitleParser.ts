/**
 * Minimal SRT / WebVTT parser. Returns lines in the same shape as
 * `CaptionLine` from youtubeService so the downstream code is identical.
 */

export type SubtitleLine = {
  start: number // ms
  dur: number // ms
  text: string
}

const TS_RE =
  /(\d{1,2}):(\d{2}):(\d{2})[.,](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[.,](\d{1,3})/

function tsToMs(h: string, m: string, s: string, ms: string): number {
  return (
    Number(h) * 3600_000 +
    Number(m) * 60_000 +
    Number(s) * 1000 +
    Number(ms.padEnd(3, '0').slice(0, 3))
  )
}

function stripTags(text: string): string {
  // Strip VTT styling tags (<c.yellow>, <v Speaker>, etc.) and SRT bold/italic.
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/\{[^}]*\}/g, '')
    .trim()
}

/** Parse SRT or VTT content into time-stamped lines. Tolerant of either
 *  `,` (SRT) or `.` (VTT) decimal separators and of WEBVTT preamble lines. */
export function parseSubtitle(input: string): SubtitleLine[] {
  if (!input.trim()) return []
  // Normalize line endings.
  const text = input.replace(/\r\n?/g, '\n').trim()
  // Split into cue blocks separated by blank lines.
  const blocks = text.split(/\n\s*\n+/)
  const lines: SubtitleLine[] = []
  for (const block of blocks) {
    // First line may be the cue index (SRT) or the timestamp itself.
    const rows = block.split('\n').map((r) => r.trim()).filter(Boolean)
    if (rows.length === 0) continue
    // Find the row containing the timestamp.
    let tsIdx = -1
    for (let i = 0; i < rows.length; i++) {
      if (TS_RE.test(rows[i])) {
        tsIdx = i
        break
      }
    }
    if (tsIdx < 0) continue
    const m = TS_RE.exec(rows[tsIdx])
    if (!m) continue
    const start = tsToMs(m[1], m[2], m[3], m[4])
    const end = tsToMs(m[5], m[6], m[7], m[8])
    const body = rows
      .slice(tsIdx + 1)
      .map(stripTags)
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (!body) continue
    lines.push({ start, dur: Math.max(0, end - start), text: body })
  }
  return lines.sort((a, b) => a.start - b.start)
}
