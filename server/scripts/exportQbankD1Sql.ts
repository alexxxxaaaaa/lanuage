/**
 * 把本地 SQLite 里的 Qbank 题库导出成可直接喂给 D1 的 SQL，按卷分片。
 *
 *   npm run import:qbank           # 先把 markdown 灌进本地库
 *   npm run export:qbank-d1-sql    # 再导出 → server/d1_qbank/
 *   bash d1_qbank/apply.sh         # 逐片打到线上 D1
 *
 * 按卷分片（31 片，每片 ~200 KB）而不是出一个大文件：wrangler 一次执行的
 * SQL 体积有限，分片还能断点续传 —— 中途失败重跑某一片即可。
 * 语句用 INSERT OR REPLACE，行 id 是稳定值，重跑不会产生重复行，
 * 也不会动 QbankAttempt / QbankFavorite（用户数据）。
 */
import 'dotenv/config'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createNodePrismaClient } from '../src/lib/prisma'

const prisma = createNodePrismaClient()
const OUT_DIR = resolve(process.cwd(), 'd1_qbank')

function sqlValue(v: unknown): string {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'number') return String(v)
  if (typeof v === 'boolean') return v ? '1' : '0'
  if (v instanceof Date) return `'${v.toISOString()}'`
  return `'${String(v).replace(/'/g, "''")}'`
}

function insertRows(table: string, rows: Record<string, unknown>[]): string[] {
  if (rows.length === 0) return []
  const cols = Object.keys(rows[0])
  const colList = cols.map((c) => `"${c}"`).join(', ')
  return rows.map(
    (row) =>
      `INSERT OR REPLACE INTO "${table}" (${colList}) VALUES (${cols
        .map((c) => sqlValue(row[c]))
        .join(', ')});`,
  )
}

async function main() {
  const papers = await prisma.qbankQuestion.findMany({
    distinct: ['level', 'year', 'month'],
    select: { level: true, year: true, month: true },
    orderBy: [{ year: 'asc' }, { month: 'asc' }],
  })

  mkdirSync(OUT_DIR, { recursive: true })
  const files: string[] = []

  for (const [idx, paper] of papers.entries()) {
    const where = { level: paper.level, year: paper.year, month: paper.month }
    const [passages, questions] = await Promise.all([
      prisma.qbankPassage.findMany({ where, orderBy: { code: 'asc' } }),
      prisma.qbankQuestion.findMany({ where, orderBy: { orderNo: 'asc' } }),
    ])

    const stamp = `${paper.year}${String(paper.month).padStart(2, '0')}`
    const name = `${String(idx + 1).padStart(2, '0')}_${paper.level.toLowerCase()}_${stamp}.sql`
    const body = [
      `-- ${paper.level} ${paper.year}年${paper.month}月：文章 ${passages.length} 篇，题目 ${questions.length} 道`,
      'PRAGMA defer_foreign_keys = ON;',
      ...insertRows('QbankPassage', passages as unknown as Record<string, unknown>[]),
      ...insertRows('QbankQuestion', questions as unknown as Record<string, unknown>[]),
      '',
    ].join('\n')

    writeFileSync(resolve(OUT_DIR, name), body, 'utf8')
    files.push(name)
    console.log(`  ${name}  文章 ${passages.length}  题目 ${questions.length}`)
  }

  const apply = [
    '#!/usr/bin/env bash',
    '# 把题库打到线上 D1。先确保表结构已经建好：',
    '#   npx wrangler d1 execute word-sprint-db --remote \\',
    '#     --file=./prisma/migrations/20260802000000_qbank/migration.sql',
    'set -euo pipefail',
    'cd "$(dirname "$0")/.."',
    'for f in d1_qbank/*.sql; do',
    '  echo "→ $f"',
    '  npx wrangler d1 execute word-sprint-db --remote --yes --file="$f"',
    'done',
    'npx wrangler d1 execute word-sprint-db --remote --command \\',
    '  "SELECT COUNT(*) AS questions FROM QbankQuestion;"',
    '',
  ].join('\n')
  writeFileSync(resolve(OUT_DIR, 'apply.sh'), apply, { mode: 0o755 })

  console.log(`\n✅ ${files.length} 个分片 → ${OUT_DIR}`)
  console.log('   上线：bash d1_qbank/apply.sh（先跑 migration.sql 建表）')
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
