/**
 * Bulk-import a grammar JSON wordlist into /api/grammar.
 *
 * Usage:
 *   API_BASE=https://word-sprint-server.zhuyandijp.workers.dev \
 *   WS_USERNAME=xxx WS_PASSWORD=yyy \
 *   JSON_PATH=server/scripts/n1_grammar.json \
 *   node --import tsx server/scripts/importGrammarToCloud.ts
 */
import { readFile } from 'node:fs/promises'

type GrammarRecord = {
  pattern: string
  connection?: string
  meaning?: string
  example?: string
  exampleZh?: string
  note?: string
  level?: string
}

const API_BASE = process.env.API_BASE ?? 'http://localhost:3000'
const USERNAME = process.env.WS_USERNAME
const PASSWORD = process.env.WS_PASSWORD
const JSON_PATH = process.env.JSON_PATH ?? 'scripts/n1_grammar.json'
const CONCURRENCY = Number(process.env.CONCURRENCY ?? '3')

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

async function postGrammar(token: string, record: GrammarRecord) {
  let lastErr: unknown
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await call('/api/grammar', {
        method: 'POST',
        token,
        body: JSON.stringify(record),
      })
    } catch (err) {
      const e = err as { status?: number }
      lastErr = err
      if (e.status === 409) throw err
      if (e.status && e.status >= 400 && e.status < 500) throw err
      await new Promise((r) => setTimeout(r, 300 * 2 ** attempt))
    }
  }
  throw lastErr
}

async function runBatch(items: GrammarRecord[], token: string) {
  let i = 0
  let added = 0
  let duplicated = 0
  let failed = 0
  const total = items.length

  async function next(): Promise<void> {
    while (true) {
      const idx = i++
      if (idx >= total) return
      try {
        await postGrammar(token, items[idx])
        added += 1
      } catch (err) {
        const e = err as { status?: number; body?: { message?: string; error?: string } }
        const msg = e?.body?.message ?? e?.body?.error ?? String(err)
        if (e.status === 409 || /already exists/i.test(msg)) {
          duplicated += 1
        } else {
          failed += 1
          console.warn(`fail #${idx + 1} (${items[idx].pattern}): ${msg.slice(0, 140)}`)
        }
      }
      if ((added + duplicated + failed) % 25 === 0 || i >= total) {
        console.log(
          `progress ${added + duplicated + failed}/${total} (added=${added} dup=${duplicated} fail=${failed})`,
        )
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => next()))
  return { added, duplicated, failed }
}

async function main() {
  const raw = await readFile(JSON_PATH, 'utf8')
  const records = JSON.parse(raw) as GrammarRecord[]
  console.log(`loaded ${records.length} grammar records from ${JSON_PATH}`)

  const token = await login()
  console.log('logged in')

  const stats = await runBatch(records, token)
  console.log(
    `done. added=${stats.added} duplicated=${stats.duplicated} failed=${stats.failed}`,
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
