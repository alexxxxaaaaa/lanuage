// Subtitle proxy — runs yt-dlp under the hood. Replaces the previous raw HTTP
// scrape, which kept getting LOGIN_REQUIRED on datacenter IPs. yt-dlp has all
// the extractor magic baked in (PO tokens, visitor data, signature ciphers).
//
// Deploy notes (Render free tier):
//   1. Build Command: `pip install --user --break-system-packages -U yt-dlp && npm install`
//      (--break-system-packages handles Ubuntu 23+ PEP 668 protection; -U keeps
//      yt-dlp current since YouTube breaks it every few weeks.)
//   2. Start Command: `npm start` (unchanged)
//   3. Make sure ~/.local/bin is on PATH (Render does this by default).
//
// Endpoints (API surface unchanged so the Cloudflare Worker keeps working):
//   GET  /healthz
//   POST /youtube/meta     {videoId}  → metadata + captionTracks (synthetic baseUrl)
//   POST /youtube/captions {baseUrl}  → parsed line array
//
// The captionTracks' baseUrl uses a synthetic `proxy://VIDEO/LANG/KIND` scheme.
// /captions parses that and looks up cached parsed lines — no second yt-dlp run.

import http from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PORT = Number(process.env.PORT) || 3001
const PROXY_TOKEN = process.env.PROXY_TOKEN || ''

// yt-dlp invocation. Default = standalone binary co-located with this file
// (Build Command on Render curl-downloads it there). Locally on a dev box the
// user can set YT_DLP_CMD="python3 -m yt_dlp" or "/usr/local/bin/yt-dlp".
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ytDlpCmdParts = (process.env.YT_DLP_CMD || path.join(__dirname, 'yt-dlp')).split(' ')

// Languages we ask yt-dlp to grab. Matches what the language-app cares about.
const SUB_LANGS = 'en,ja,zh,zh-Hans,zh-CN'

// YouTube now gates subtitles behind a PO token. yt-dlp can fall back to using
// a logged-in user's cookies to satisfy the check. Two ways to supply them:
//   - YT_COOKIES_FROM_BROWSER=chrome|safari|firefox  (local dev — yt-dlp reads
//     directly from the browser's cookie store)
//   - YT_COOKIES_FILE=/etc/secrets/cookies.txt  (deployment — exported once
//     from a logged-in browser, refreshed every 1-2 weeks)
// Without either, subtitle requests will return empty captionTracks for most
// videos.
const YT_COOKIES_FROM_BROWSER = process.env.YT_COOKIES_FROM_BROWSER || ''
const YT_COOKIES_FILE = process.env.YT_COOKIES_FILE || ''

function cookieArgs() {
  if (YT_COOKIES_FILE) return ['--cookies', YT_COOKIES_FILE]
  if (YT_COOKIES_FROM_BROWSER) return ['--cookies-from-browser', YT_COOKIES_FROM_BROWSER]
  return []
}

// In-memory cache: one yt-dlp run populates BOTH /meta and /captions responses,
// so the Worker's typical (meta → captions → captions) burst hits the cache for
// 2 of 3 calls. TTL kept low because YouTube responses can age out.
const CACHE_TTL_MS = 10 * 60 * 1000
const cache = new Map() // videoId -> { meta, linesByKey: Map, expiresAt }

function runYtdlp(args) {
  return new Promise((resolve, reject) => {
    const [cmd, ...preArgs] = ytDlpCmdParts
    const proc = spawn(cmd, [...preArgs, ...args])
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (d) => {
      stdout += d
    })
    proc.stderr.on('data', (d) => {
      stderr += d
    })
    proc.on('error', reject)
    // Resolve regardless of exit code — yt-dlp sometimes raises during cleanup
    // (e.g. cache writes) AFTER the info.json + subtitle files are already on
    // disk. We treat the on-disk artifacts as the source of truth and let the
    // caller decide if it got what it needs.
    proc.on('close', (code) => {
      resolve({ stdout, stderr, code })
    })
  })
}

function parseJson3(data) {
  const events = data.events ?? []
  const lines = []
  for (const ev of events) {
    if (!ev.segs) continue
    const text = ev.segs
      .map((s) => s.utf8 ?? '')
      .join('')
      .replace(/\n/g, ' ')
      .trim()
    if (!text) continue
    lines.push({
      start: ev.tStartMs ?? 0,
      dur: ev.dDurationMs ?? 0,
      text,
    })
  }
  return lines
}

async function extract(videoId) {
  const tempDir = await mkdtemp(path.join(tmpdir(), `yt-${videoId}-`))
  try {
    const url = `https://www.youtube.com/watch?v=${videoId}`
    // Note: --dump-single-json suppresses actual file writes, so we use
    // --write-info-json instead and read the .info.json from disk after.
    const args = [
      '--no-warnings',
      '--quiet',
      '--write-info-json',
      '--write-subs',
      '--write-auto-subs',
      '--sub-langs',
      SUB_LANGS,
      '--sub-format',
      'json3',
      '--skip-download',
      // Some videos (livestreams, DRM-only, members-only previews) have no
      // downloadable video format; yt-dlp would otherwise abort even though
      // we only care about subtitles + metadata.
      '--ignore-no-formats-error',
      '--no-cache-dir',
      '--ignore-config',
      ...cookieArgs(),
      '-o',
      path.join(tempDir, '%(id)s.%(ext)s'),
      url,
    ]
    const { stderr, code } = await runYtdlp(args)
    const infoPath = path.join(tempDir, `${videoId}.info.json`)
    let info
    try {
      info = JSON.parse(await readFile(infoPath, 'utf-8'))
    } catch {
      throw Object.assign(
        new Error(
          `yt-dlp produced no info.json for ${videoId} (exit ${code}): ${stderr.replace(/\s+/g, ' ').slice(0, 300)}`,
        ),
        { status: 502 },
      )
    }

    // Read every json3 subtitle file yt-dlp dropped into the temp dir.
    const files = await readdir(tempDir)
    const linesByKey = new Map()
    const tracks = []
    for (const file of files) {
      if (!file.endsWith('.json3')) continue
      // yt-dlp filename pattern: VIDEOID.LANG.json3
      const m = file.match(/\.([\w-]+)\.json3$/)
      if (!m) continue
      const lang = m[1]
      try {
        const raw = await readFile(path.join(tempDir, file), 'utf-8')
        const data = JSON.parse(raw)
        const lines = parseJson3(data)
        if (lines.length === 0) continue
        // Disambiguate "manual subs" vs "auto-generated" by checking which
        // bucket yt-dlp listed this language under.
        const inManual = !!info?.subtitles?.[lang]
        const kind = inManual ? 'manual' : 'asr'
        const key = `${lang}:${kind}`
        if (linesByKey.has(key)) continue // already captured (prefer first/longer)
        linesByKey.set(key, lines)
        const trackInfo =
          info?.subtitles?.[lang]?.[0] ?? info?.automatic_captions?.[lang]?.[0]
        tracks.push({
          languageCode: lang,
          name: trackInfo?.name ?? lang,
          kind,
          baseUrl: `proxy://${videoId}/${encodeURIComponent(lang)}/${kind}`,
        })
      } catch {
        // bad json3 file — skip, but other tracks may still succeed
      }
    }

    // Pick the highest-resolution thumbnail yt-dlp surfaced.
    let thumbnail = info?.thumbnail ?? ''
    if (!thumbnail && Array.isArray(info?.thumbnails) && info.thumbnails.length > 0) {
      thumbnail = info.thumbnails[info.thumbnails.length - 1]?.url ?? ''
    }

    return {
      meta: {
        videoId,
        title: info?.title ?? '',
        durationSec: info?.duration ? Math.round(Number(info.duration)) : 0,
        thumbnail,
        captionTracks: tracks,
      },
      linesByKey,
    }
  } finally {
    // Fire-and-forget cleanup — failure here shouldn't fail the request.
    rm(tempDir, { recursive: true, force: true }).catch(() => {})
  }
}

async function getOrExtract(videoId) {
  const now = Date.now()
  const cached = cache.get(videoId)
  if (cached && cached.expiresAt > now) return cached
  const result = await extract(videoId)
  cache.set(videoId, { ...result, expiresAt: now + CACHE_TTL_MS })
  return result
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
    return send(res, 200, { ok: true, uptime: process.uptime() })
  }

  if (!checkAuth(req)) {
    return send(res, 401, { message: 'unauthorized' })
  }

  try {
    if (req.method === 'POST' && url.pathname === '/youtube/meta') {
      const body = await readBody(req)
      if (!body.videoId) return send(res, 400, { message: 'videoId required' })
      const { meta } = await getOrExtract(String(body.videoId))
      return send(res, 200, meta)
    }
    if (req.method === 'POST' && url.pathname === '/youtube/captions') {
      const body = await readBody(req)
      if (!body.baseUrl) return send(res, 400, { message: 'baseUrl required' })
      const m = String(body.baseUrl).match(/^proxy:\/\/([^/]+)\/([^/]+)\/([^/]+)$/)
      if (!m) {
        return send(res, 400, {
          message: `invalid baseUrl (expected proxy:// scheme): ${String(body.baseUrl).slice(0, 80)}`,
        })
      }
      const [, videoId, langEnc, kind] = m
      const lang = decodeURIComponent(langEnc)
      const { linesByKey } = await getOrExtract(videoId)
      const lines = linesByKey.get(`${lang}:${kind}`) ?? []
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
