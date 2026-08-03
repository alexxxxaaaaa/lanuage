/**
 * Bulk-import a JSON wordlist into the cloud (or any) Word Sprint API.
 *
 * Pipeline:
 *   1. Login with username/password to get a JWT.
 *   2. Ensure target folder exists (matched by name + language); create if missing.
 *   3. POST each word in small parallel batches; skip duplicates (server returns 409).
 *
 * Usage (env-driven, so secrets don't end up in shell history):
 *   API_BASE=https://word-sprint-server.zhuyandijp.workers.dev \
 *   WS_USERNAME=xxx WS_PASSWORD=yyy \
 *   FOLDER_NAME=N1 FOLDER_LANGUAGE=jp \
 *   JSON_PATH=server/scripts/n1.json \
 *   npm --workspace server run import:words
 */

import { readFile } from 'node:fs/promises'

type WordRecord = {
  word: string
  reading: string
  partOfSpeech: string
  meaning: string
  example: string
  note: string
  language: 'en' | 'jp'
}

type Folder = { id: string; name: string; language: 'en' | 'jp' }

const API_BASE = process.env.API_BASE ?? 'http://localhost:3000'
const USERNAME = process.env.WS_USERNAME
const PASSWORD = process.env.WS_PASSWORD
const JSON_PATH = process.env.JSON_PATH ?? 'server/scripts/n1.json'
const FOLDER_NAME = process.env.FOLDER_NAME ?? 'N1'
const FOLDER_LANGUAGE = (process.env.FOLDER_LANGUAGE ?? 'jp') as 'en' | 'jp'
const CONCURRENCY = Number(process.env.CONCURRENCY ?? '4')

if (!USERNAME || !PASSWORD) {
  console.error('Set WS_USERNAME and WS_PASSWORD env vars.')
  process.exit(2)
}

async function call<T>(
  path: string,
  init: RequestInit & { token?: string } = {},
): Promise<T> {
  const { token, headers, ...rest } = init
  const res = await fetch(`${API_BASE}${path}`, {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(headers ?? {}),
    },
  })
  const text = await res.text()
  let body: unknown = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    // Server returned non-JSON (typically a Cloudflare HTML error page).
    body = { error: `non-json response: ${text.slice(0, 160).replace(/\s+/g, ' ')}` }
  }
  if (!res.ok) {
    const err = new Error(
      `${init.method ?? 'GET'} ${path} -> ${res.status} ${JSON.stringify(body)}`,
    ) as Error & { status?: number; body?: unknown }
    err.status = res.status
    err.body = body
    throw err
  }
  return body as T
}

async function login() {
  const { token } = await call<{ token: string }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  })
  return token
}

async function ensureFolder(token: string): Promise<Folder> {
  const folders = await call<Folder[]>('/api/folders', { token })
  const existing = folders.find(
    (f) => f.name === FOLDER_NAME && f.language === FOLDER_LANGUAGE,
  )
  if (existing) {
    console.log(`reusing existing folder ${existing.id} (${existing.name})`)
    return existing
  }
  const created = await call<Folder>('/api/folders', {
    method: 'POST',
    token,
    body: JSON.stringify({ name: FOLDER_NAME, language: FOLDER_LANGUAGE }),
  })
  console.log(`created folder ${created.id}`)
  return created
}

async function postWord(token: string, folderId: string, record: WordRecord) {
  const payload = JSON.stringify({ ...record, folderIds: [folderId] })
  // Retry on transient gateway errors / non-JSON HTML responses. Stop on 409
  // (duplicate) and other 4xx since those are deterministic.
  let lastErr: unknown
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await call('/api/words', { method: 'POST', token, body: payload })
    } catch (err) {
      const e = err as { status?: number }
      lastErr = err
      if (e.status === 409) throw err
      if (e.status && e.status >= 400 && e.status < 500) throw err
      await new Promise((r) => setTimeout(r, 200 * 2 ** attempt))
    }
  }
  throw lastErr
}

async function runBatch<T>(items: T[], worker: (item: T) => Promise<void>) {
  let i = 0
  let added = 0
  let duplicated = 0
  let failed = 0
  const total = items.length

  async function next(): Promise<void> {
    const idx = i++
    if (idx >= total) return
    const item = items[idx]
    try {
      await worker(item)
      added += 1
    } catch (err) {
      const e = err as { status?: number; body?: { error?: string } }
      const msg = e?.body?.error ?? String(err)
      if (e.status === 409 || /already exists|unique/i.test(msg)) {
        duplicated += 1
      } else {
        failed += 1
        console.warn(`fail #${idx + 1}: ${msg}`)
      }
    }
    if ((added + duplicated + failed) % 50 === 0 || i >= total) {
      console.log(
        `progress ${added + duplicated + failed}/${total} (added=${added} dup=${duplicated} fail=${failed})`,
      )
    }
    return next()
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => next()))
  return { added, duplicated, failed }
}

async function main() {
  const raw = await readFile(JSON_PATH, 'utf8')
  const records = JSON.parse(raw) as WordRecord[]
  console.log(`loaded ${records.length} records from ${JSON_PATH}`)

  const token = await login()
  console.log('logged in')

  const folder = await ensureFolder(token)

  const stats = await runBatch(records, async (r) => {
    await postWord(token, folder.id, r)
  })
  console.log(
    `done. added=${stats.added} duplicated=${stats.duplicated} failed=${stats.failed}`,
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
