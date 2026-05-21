/**
 * Light-weight YouTube metadata + captions scraper for Cloudflare Workers.
 *
 * We do NOT use the official Data API (avoids API keys / quotas). Instead we
 * fetch the watch page HTML, pull `ytInitialPlayerResponse` out, and use the
 * caption track URLs it exposes. Then fetch each track in json3 format.
 *
 * Caveats: relies on YouTube's internal page shape and unofficial caption
 * endpoint. If they restructure either, this breaks. For a personal-use app
 * that's an acceptable tradeoff vs. the official API's per-quota costs.
 */
import { AppError } from '../errors/AppError'

export type CaptionTrack = {
  languageCode: string
  name: string
  /** 'asr' means auto-generated captions. */
  kind: 'asr' | 'manual'
  baseUrl: string
}

export type VideoMeta = {
  videoId: string
  title: string
  durationSec: number
  thumbnail: string
  captionTracks: CaptionTrack[]
}

export type CaptionLine = {
  start: number
  dur: number
  text: string
}

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36'

/** Mimic a normal Chrome request well enough that YouTube doesn't immediately
 *  serve the consent interstitial or 429. The CONSENT cookie skips the EU
 *  consent wall which is a common reason watch pages return non-standard
 *  HTML to non-browser clients. */
function browserHeaders(): Record<string, string> {
  return {
    'User-Agent': BROWSER_UA,
    Accept:
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
    Cookie: 'CONSENT=YES+cb.20210328-17-p0.en+FX+000',
  }
}

export function extractVideoId(input: string): string | null {
  const raw = input.trim()
  // Bare 11-char id?
  if (/^[A-Za-z0-9_-]{11}$/.test(raw)) return raw
  try {
    const u = new URL(raw)
    if (u.hostname === 'youtu.be') {
      const id = u.pathname.slice(1).split(/[/?]/)[0]
      return id || null
    }
    if (u.hostname.endsWith('youtube.com') || u.hostname.endsWith('youtube-nocookie.com')) {
      if (u.pathname === '/watch') {
        return u.searchParams.get('v')
      }
      const m = u.pathname.match(/\/(shorts|embed|live)\/([^/?]+)/)
      if (m) return m[2]
    }
  } catch {
    return null
  }
  return null
}

type PlayerResponse = {
  videoDetails?: {
    title?: string
    lengthSeconds?: string
    thumbnail?: { thumbnails?: Array<{ url?: string }> }
  }
  captions?: {
    playerCaptionsTracklistRenderer?: {
      captionTracks?: Array<{
        languageCode?: string
        kind?: string
        baseUrl?: string
        name?: { simpleText?: string; runs?: Array<{ text?: string }> }
      }>
    }
  }
}

async function fetchWithRetry(url: string, headers: Record<string, string>): Promise<Response> {
  // YouTube occasionally serves 429 to repeated requests from Cloudflare's
  // shared IP space. One quick retry after a short wait usually clears it.
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(url, { headers })
    if (res.ok || (res.status !== 429 && res.status !== 503)) return res
    if (attempt === 0) await new Promise((r) => setTimeout(r, 600))
  }
  return fetch(url, { headers })
}

/** Pull a balanced JSON object that starts at the first `{` after `marker`. */
function extractJsonAfter(html: string, marker: string): unknown {
  const i = html.indexOf(marker)
  if (i < 0) return null
  const start = html.indexOf('{', i + marker.length)
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escape = false
  for (let k = start; k < html.length; k++) {
    const c = html[k]
    if (inString) {
      if (escape) escape = false
      else if (c === '\\') escape = true
      else if (c === '"') inString = false
      continue
    }
    if (c === '"') {
      inString = true
    } else if (c === '{') {
      depth++
    } else if (c === '}') {
      depth--
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, k + 1))
        } catch {
          return null
        }
      }
    }
  }
  return null
}

const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'

const GOOGLEBOT_UA =
  'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/41.0.2272.96 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'

/** `bpctr=9999999999` is the yt-dlp trick that bypasses age-gates / consent
 *  interstitials by setting the timestamp past which the gate clears.
 *  `has_verified=1` confirms age in one shot. */
function watchUrl(domain: string, id: string): string {
  return `https://${domain}/watch?v=${id}&hl=en&bpctr=9999999999&has_verified=1`
}

/** Pretend to be Googlebot last — some sites special-case Google crawlers
 *  and serve a less-restricted version. */
const WATCH_TARGETS: Array<{ url: (id: string) => string; headers: Record<string, string> }> = [
  {
    url: (id) => watchUrl('m.youtube.com', id),
    headers: { ...browserHeaders(), 'User-Agent': MOBILE_UA },
  },
  {
    url: (id) => watchUrl('www.youtube.com', id),
    headers: browserHeaders(),
  },
  {
    url: (id) => watchUrl('www.youtube-nocookie.com', id),
    headers: browserHeaders(),
  },
  {
    url: (id) => watchUrl('m.youtube.com', id),
    headers: {
      'User-Agent': GOOGLEBOT_UA,
      'Accept-Language': 'en-US,en;q=0.9',
    },
  },
]

/** oEmbed returns title + thumbnail without scraping the watch page. Hosted
 *  on a different surface that YouTube doesn't IP-block, so this works from
 *  Cloudflare Workers even when the watch page is 429'd. No duration field,
 *  no caption tracks — meant as a fallback for manual-subtitle imports. */
export async function fetchVideoMetaViaOEmbed(videoId: string): Promise<{
  title: string
  thumbnail: string
}> {
  // URL-encode the inner watch URL — without that, YouTube's oEmbed sees
  // the inner `?v=` as part of the outer query string and returns nothing.
  const target = `https://www.youtube.com/watch?v=${videoId}`
  const res = await fetch(
    `https://www.youtube.com/oembed?url=${encodeURIComponent(target)}&format=json`,
    { headers: { 'User-Agent': BROWSER_UA, 'Accept-Language': 'en-US,en;q=0.9' } },
  )
  if (!res.ok) {
    throw new AppError(`oEmbed fetch failed (${res.status})`, 502)
  }
  const data = (await res.json()) as { title?: string; thumbnail_url?: string }
  return {
    title: data.title ?? '',
    thumbnail: data.thumbnail_url ?? '',
  }
}

export async function fetchVideoMeta(videoId: string): Promise<VideoMeta> {
  const errors: Array<{ url: string; status: number }> = []
  for (const target of WATCH_TARGETS) {
    const url = target.url(videoId)
    const res = await fetchWithRetry(url, target.headers)
    if (!res.ok) {
      errors.push({ url, status: res.status })
      continue
    }
    const html = await res.text()
    const data = extractJsonAfter(html, 'ytInitialPlayerResponse') as PlayerResponse | null
    if (!data) {
      errors.push({ url, status: 200 })
      continue
    }
    const vd = data.videoDetails ?? {}
    const tracks = data.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? []
    const thumbs = vd.thumbnail?.thumbnails ?? []
    return {
      videoId,
      title: vd.title ?? '',
      durationSec: Number.parseInt(vd.lengthSeconds ?? '0', 10) || 0,
      thumbnail: thumbs.length > 0 ? thumbs[thumbs.length - 1].url ?? '' : '',
      captionTracks: tracks
        .filter((t) => t.baseUrl && t.languageCode)
        .map((t) => ({
          languageCode: t.languageCode as string,
          name:
            t.name?.simpleText ??
            t.name?.runs?.[0]?.text ??
            (t.languageCode as string),
          kind: t.kind === 'asr' ? ('asr' as const) : ('manual' as const),
          baseUrl: t.baseUrl as string,
        })),
    }
  }
  const has429 = errors.some((e) => e.status === 429)
  const summary = errors.map((e) => `${new URL(e.url).hostname}=${e.status}`).join(', ')
  if (has429) {
    throw new AppError(
      `YouTube blocked the server temporarily (${summary}). YouTube rate-limits Cloudflare's shared IP space; please try again in a few minutes.`,
      502,
    )
  }
  throw new AppError(`YouTube fetch failed (${summary})`, 502)
}

type Json3Caption = {
  events?: Array<{
    tStartMs?: number
    dDurationMs?: number
    segs?: Array<{ utf8?: string }>
  }>
}

export async function fetchCaptionLines(baseUrl: string): Promise<CaptionLine[]> {
  // Append `&fmt=json3` for parseable JSON. The baseUrl already carries query.
  const url = baseUrl.includes('?') ? `${baseUrl}&fmt=json3` : `${baseUrl}?fmt=json3`
  // Caption fetch tends to need a real browser-like UA — the timedtext
  // endpoint serves Googlebot an empty body. Try browser UA first, fall back
  // to mobile UA if that 429s.
  const headerVariants: Record<string, string>[] = [
    browserHeaders(),
    { 'User-Agent': MOBILE_UA, 'Accept-Language': 'en-US,en;q=0.9' },
  ]
  let lastStatus = 0
  let lastBody = ''
  for (const headers of headerVariants) {
    const res = await fetchWithRetry(url, headers)
    if (!res.ok) {
      lastStatus = res.status
      continue
    }
    const text = await res.text()
    if (!text.trim()) {
      lastStatus = 200
      lastBody = '(empty body)'
      continue
    }
    let data: Json3Caption
    try {
      data = JSON.parse(text) as Json3Caption
    } catch {
      lastStatus = 200
      lastBody = text.slice(0, 120)
      continue
    }
    const events = data.events ?? []
    const lines: CaptionLine[] = []
    for (const ev of events) {
      if (!ev.segs) continue
      const lineText = ev.segs
        .map((s) => s.utf8 ?? '')
        .join('')
        .replace(/\n/g, ' ')
        .trim()
      if (!lineText) continue
      lines.push({
        start: ev.tStartMs ?? 0,
        dur: ev.dDurationMs ?? 0,
        text: lineText,
      })
    }
    return lines
  }
  throw new AppError(
    `caption fetch failed (${lastStatus}${lastBody ? ': ' + lastBody : ''})`,
    502,
  )
}

/** Pick the best caption track for the requested language. Prefer manual
 *  (non-asr) over auto-generated; prefer exact code match over prefix. */
export function pickCaptionTrack(
  tracks: CaptionTrack[],
  languageCode: string,
): CaptionTrack | null {
  if (tracks.length === 0) return null
  const code = languageCode.toLowerCase()
  const prefix = code.split('-')[0]
  const candidates = tracks.filter(
    (t) =>
      t.languageCode.toLowerCase() === code ||
      t.languageCode.toLowerCase().startsWith(`${prefix}-`) ||
      t.languageCode.toLowerCase() === prefix,
  )
  if (candidates.length === 0) return null
  // Prefer manual then exact match.
  const manualExact = candidates.find(
    (t) => t.kind === 'manual' && t.languageCode.toLowerCase() === code,
  )
  if (manualExact) return manualExact
  const manual = candidates.find((t) => t.kind === 'manual')
  if (manual) return manual
  const asrExact = candidates.find((t) => t.languageCode.toLowerCase() === code)
  return asrExact ?? candidates[0]
}
