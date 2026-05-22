// Tiny HTTP service that proxies YouTube watch-page + caption fetches from
// a non-Cloudflare IP. Cloudflare's shared edge IPs are heavily rate-limited
// by YouTube; this service runs somewhere YouTube doesn't blacklist
// (Render / Railway / your own machine) and the Worker calls it instead.
//
// Endpoints (all require `Authorization: Bearer <PROXY_TOKEN>` when the
// PROXY_TOKEN env var is set):
//
//   GET  /healthz                        → liveness probe
//   POST /youtube/meta     {videoId}     → { title, durationSec, thumbnail,
//                                            captionTracks: [...] }
//   POST /youtube/captions {baseUrl}     → [{ start, dur, text }]
//
// Node 18+ has built-in fetch — no dependencies.

import http from 'node:http'

const PORT = Number(process.env.PORT) || 3001
const PROXY_TOKEN = process.env.PROXY_TOKEN || ''
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36'
const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile Safari/604.1'

function browserHeaders() {
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

function extractJsonAfter(html, marker) {
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
    if (c === '"') inString = true
    else if (c === '{') depth++
    else if (c === '}') {
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

function watchUrl(domain, id) {
  return `https://${domain}/watch?v=${id}&hl=en&bpctr=9999999999&has_verified=1`
}

const WATCH_TARGETS = [
  { url: (id) => watchUrl('m.youtube.com', id), headers: () => ({ ...browserHeaders(), 'User-Agent': MOBILE_UA }) },
  { url: (id) => watchUrl('www.youtube.com', id), headers: browserHeaders },
  { url: (id) => watchUrl('www.youtube-nocookie.com', id), headers: browserHeaders },
]

async function fetchWithRetry(url, headers) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(url, { headers })
    if (res.ok || (res.status !== 429 && res.status !== 503)) return res
    if (attempt === 0) await new Promise((r) => setTimeout(r, 600))
  }
  return fetch(url, { headers })
}

async function fetchVideoMeta(videoId) {
  const errors = []
  for (const target of WATCH_TARGETS) {
    const url = target.url(videoId)
    const res = await fetchWithRetry(url, target.headers())
    if (!res.ok) {
      errors.push(`${new URL(url).hostname}=${res.status}`)
      continue
    }
    const html = await res.text()
    const data = extractJsonAfter(html, 'ytInitialPlayerResponse')
    if (!data) {
      errors.push(`${new URL(url).hostname}=no-player-response`)
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
          languageCode: t.languageCode,
          name: t.name?.simpleText ?? t.name?.runs?.[0]?.text ?? t.languageCode,
          kind: t.kind === 'asr' ? 'asr' : 'manual',
          baseUrl: t.baseUrl,
        })),
    }
  }
  const err = new Error(`YouTube fetch failed (${errors.join(', ')})`)
  err.status = 502
  throw err
}

async function fetchCaptionLines(baseUrl) {
  const url = baseUrl.includes('?') ? `${baseUrl}&fmt=json3` : `${baseUrl}?fmt=json3`
  const res = await fetchWithRetry(url, browserHeaders())
  if (!res.ok) {
    const err = new Error(`caption fetch failed (${res.status})`)
    err.status = 502
    throw err
  }
  const text = await res.text()
  let data
  try {
    data = JSON.parse(text)
  } catch {
    const err = new Error(`caption response not JSON: ${text.slice(0, 120)}`)
    err.status = 502
    throw err
  }
  const events = data.events ?? []
  const lines = []
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

// ---------- HTTP plumbing ----------

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8')
        resolve(raw ? JSON.parse(raw) : {})
      } catch (e) {
        reject(e)
      }
    })
    req.on('error', reject)
  })
}

function checkAuth(req) {
  if (!PROXY_TOKEN) return true
  return req.headers.authorization === `Bearer ${PROXY_TOKEN}`
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)

  if (req.method === 'GET' && url.pathname === '/healthz') {
    send(res, 200, { ok: true, uptime: process.uptime() })
    return
  }

  if (!checkAuth(req)) {
    send(res, 401, { message: 'unauthorized' })
    return
  }

  try {
    if (req.method === 'POST' && url.pathname === '/youtube/meta') {
      const body = await readBody(req)
      if (!body.videoId) return send(res, 400, { message: 'videoId required' })
      const meta = await fetchVideoMeta(String(body.videoId))
      return send(res, 200, meta)
    }
    if (req.method === 'POST' && url.pathname === '/youtube/captions') {
      const body = await readBody(req)
      if (!body.baseUrl) return send(res, 400, { message: 'baseUrl required' })
      const lines = await fetchCaptionLines(String(body.baseUrl))
      return send(res, 200, { lines })
    }
    send(res, 404, { message: 'not found' })
  } catch (e) {
    const status = e.status ?? 500
    send(res, status, { message: e.message ?? 'internal error' })
  }
})

server.listen(PORT, () => {
  console.log(`subtitle-proxy listening on :${PORT}`)
})
