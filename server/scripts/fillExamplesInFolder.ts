/**
 * 一次性脚本:为某个分类下的所有单词补 `example` 字段。
 * 调用 /api/ai/fill-word 拿到 AI 生成结果,只把 example 写回。
 * 已经有例句的单词会跳过,所以中断后重跑可以无缝续传。
 *
 * 用法:
 *   API_BASE=https://word-sprint-server.zhuyandijp.workers.dev \
 *   WS_USERNAME=xxx WS_PASSWORD=yyy \
 *   FOLDER_NAME='N1必背2000' FOLDER_LANGUAGE=jp \
 *   node --import tsx server/scripts/fillExamplesInFolder.ts
 */

type WordRow = {
  id: string
  word: string
  reading: string
  meaning: string
  example: string | null
  language: 'en' | 'jp'
  folderId: string | null
}

type Folder = { id: string; name: string; language: 'en' | 'jp' }

const API_BASE = process.env.API_BASE ?? 'http://localhost:3000'
const USERNAME = process.env.WS_USERNAME
const PASSWORD = process.env.WS_PASSWORD
const FOLDER_NAME = process.env.FOLDER_NAME ?? 'N1必背2000'
const FOLDER_LANGUAGE = (process.env.FOLDER_LANGUAGE ?? 'jp') as 'en' | 'jp'
const CONCURRENCY = Number(process.env.CONCURRENCY ?? '2')
const LIMIT = process.env.LIMIT ? Number(process.env.LIMIT) : null

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

async function findFolder(token: string): Promise<Folder> {
  const folders = await call<Folder[]>('/api/folders', { token })
  const match = folders.find(
    (f) => f.name === FOLDER_NAME && f.language === FOLDER_LANGUAGE,
  )
  if (!match) {
    throw new Error(
      `folder not found: name=${FOLDER_NAME} language=${FOLDER_LANGUAGE}. Have: ${folders.map((f) => `${f.name}/${f.language}`).join(', ')}`,
    )
  }
  return match
}

async function fetchExample(token: string, w: WordRow): Promise<string> {
  let lastErr: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await call<{ example?: string }>('/api/ai/example-only', {
        method: 'POST',
        token,
        body: JSON.stringify({
          word: w.word,
          reading: w.reading,
          meaning: w.meaning,
          language: w.language ?? 'jp',
        }),
      })
      return (result.example ?? '').trim()
    } catch (err) {
      const e = err as { status?: number }
      lastErr = err
      if (e.status === 429) throw err
      if (e.status && e.status >= 400 && e.status < 500) throw err
      await new Promise((r) => setTimeout(r, 400 * 2 ** attempt))
    }
  }
  throw lastErr
}

async function patchExample(token: string, id: string, example: string) {
  let lastErr: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await call(`/api/words/${id}`, {
        method: 'PATCH',
        token,
        body: JSON.stringify({ example }),
      })
      return
    } catch (err) {
      const e = err as { status?: number }
      lastErr = err
      if (e.status && e.status >= 400 && e.status < 500) throw err
      await new Promise((r) => setTimeout(r, 400 * 2 ** attempt))
    }
  }
  throw lastErr
}

async function runBatch<T>(items: T[], worker: (item: T) => Promise<void>) {
  let i = 0
  let ok = 0
  let skipped = 0
  let failed = 0
  // Annotate as a mutable holder so TS does not narrow it to `null` based on
  // the linear control flow (the closure mutation below is opaque to it).
  const state: { stop: Error | null } = { stop: null }
  const total = items.length

  async function next(): Promise<void> {
    while (true) {
      if (state.stop) return
      const idx = i++
      if (idx >= total) return
      try {
        await worker(items[idx])
        ok += 1
      } catch (err) {
        const e = err as { status?: number; body?: { error?: string } }
        const msg = e?.body?.error ?? String(err)
        if (e.status === 429) {
          state.stop = new Error(`budget exhausted: ${msg}`)
          return
        }
        if (/empty example/i.test(msg)) {
          skipped += 1
        } else {
          failed += 1
          console.warn(`fail #${idx + 1} (${msg.slice(0, 140)})`)
        }
      }
      if ((ok + skipped + failed) % 25 === 0 || i >= total) {
        console.log(
          `progress ${ok + skipped + failed}/${total} (ok=${ok} skip=${skipped} fail=${failed})`,
        )
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => next()))
  return { ok, skipped, failed, stop: state.stop }
}

async function main() {
  const token = await login()
  console.log('logged in')

  const folder = await findFolder(token)
  console.log(`folder ${folder.name} (${folder.id})`)

  const all = await call<WordRow[]>(
    `/api/words?folderId=${encodeURIComponent(folder.id)}`,
    { token },
  )
  console.log(`folder has ${all.length} words`)

  let targets = all.filter((w) => !w.example || !w.example.trim())
  if (LIMIT && LIMIT > 0) targets = targets.slice(0, LIMIT)

  console.log(`${targets.length} words to fill${LIMIT ? ` (LIMIT=${LIMIT})` : ''}`)
  if (targets.length === 0) return

  const stats = await runBatch(targets, async (w) => {
    const example = await fetchExample(token, w)
    if (!example) throw new Error('empty example returned')
    await patchExample(token, w.id, example)
  })

  console.log(`done. ok=${stats.ok} skipped=${stats.skipped} failed=${stats.failed}`)
  if (stats.stop) {
    console.warn(`⚠ ${stats.stop.message}`)
    console.warn('  Re-run to resume — already-filled words are skipped.')
    process.exit(3)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
