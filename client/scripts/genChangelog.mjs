/**
 * 从 git log 生成更新历史，写进 src/generated/changelog.ts。
 *
 * 为什么是「生成后提交进仓库」而不是构建时现跑：Cloudflare Pages 构建环境
 * 很可能是浅克隆（depth=1），那里 `git log` 只看得到一条。生成物纳入版本
 * 管理，构建时只是 import 一个普通模块，不依赖任何 git 状态。
 *
 * 用法：发版前跑一次 `npm run changelog`，把改动和生成物一起提交。
 */
import { execSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(HERE, '../src/generated/changelog.ts')

/** 列表里留多少条。再往前翻意义不大，文件也不该无限变大。 */
const MAX_ENTRIES = 120

// %x1f 是单元分隔符，%x1e 是记录分隔符 —— 用不可见字符分隔，免得提交信息里
// 本来就有的符号把解析弄乱。
const RAW = execSync(
  `git log -n ${MAX_ENTRIES} --no-merges --date=short --format=%h%x1f%ad%x1f%s%x1e`,
  { cwd: resolve(HERE, '../..'), encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
)

const commits = RAW.split('\x1e')
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => {
    const [sha, date, subject] = line.split('\x1f')
    return { sha, date, subject }
  })
  .filter((c) => c.sha && c.date && c.subject)

// 按天归组：同一天的几个提交并成一条「更新」，对着看更像版本记录而不是流水账。
const byDate = new Map()
for (const c of commits) {
  if (!byDate.has(c.date)) byDate.set(c.date, [])
  byDate.get(c.date).push({ sha: c.sha, subject: c.subject })
}

const entries = [...byDate.entries()].map(([date, items]) => ({ date, items }))

const banner = `// 这个文件由 scripts/genChangelog.mjs 生成，不要手改。
// 重新生成：npm run changelog
`

writeFileSync(
  OUT.replace(/[^/]+$/, '') ? OUT : OUT,
  `${banner}
export type ChangelogItem = { sha: string; subject: string }
export type ChangelogEntry = { date: string; items: ChangelogItem[] }

export const CHANGELOG: ChangelogEntry[] = ${JSON.stringify(entries, null, 2)}
`,
)

console.log(`写入 ${entries.length} 天 / ${commits.length} 条提交 → src/generated/changelog.ts`)
