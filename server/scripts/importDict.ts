/**
 * 把 data/dict/*.jsonl.gz 灌进词库表。
 *
 *   npm run import:dict          # → 本地 SQLite（dev.db）
 *   npm run import:dict -- --d1  # → 生成分片 SQL 到 server/d1_dict/
 *   bash d1_dict/apply.sh        # 逐片打到线上 D1
 *
 * 两种模式读同一份 JSONL、走同一套行映射，所以本地和线上不会长出差异。
 *
 * 词库是可随时重灌的公共数据：两种模式都先清空整张表再整批插入。
 * DictEntry 不参与任何外键，也不挂用户，清空不会波及用户数据。
 */
import 'dotenv/config'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createNodePrismaClient } from '../src/lib/prisma'
import { readDictLines, resolveDictFile } from './dictFile'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DICT_DIR = join(ROOT, 'data', 'dict')
const D1_OUT = resolve(process.cwd(), 'd1_dict')
const DIRECTIONS = ['ja-zh', 'zh-ja'] as const

/** 建表迁移目录名，写进 apply.sh。改了迁移名记得同步这里。 */
const MIGRATION = '20260803120000_dict_entry'

/** 单片 SQL 的体积上限 —— wrangler 一次执行的 SQL 有大小限制，且分片能断点续传。 */
const SHARD_BYTES = 400_000

/** 一行 JSONL → 一行数据库记录。senses 落库前转成 JSON 字符串。 */
type Row = {
  word: string
  reading: string
  romaji: string
  pos: string
  senses: string
  direction: string
  source: string
  sortKey: string
}

async function* readRows(): AsyncGenerator<Row> {
  for (const direction of DIRECTIONS) {
    const rl = readDictLines(resolveDictFile(DICT_DIR, direction))
    for await (const line of rl) {
      if (!line) continue
      const e = JSON.parse(line)
      yield {
        word: e.word,
        reading: e.reading ?? '',
        romaji: e.romaji ?? '',
        pos: e.pos ?? '',
        senses: JSON.stringify(e.senses ?? []),
        direction: e.direction,
        source: e.source,
        sortKey: e.sortKey ?? '',
      }
    }
  }
}

function sqlValue(v: string): string {
  return `'${v.replace(/'/g, "''")}'`
}

const COLUMNS = ['word', 'reading', 'romaji', 'pos', 'senses', 'direction', 'source', 'sortKey']
const COL_LIST = COLUMNS.map((c) => `"${c}"`).join(', ')

function insertStatement(row: Row): string {
  const values = COLUMNS.map((c) => sqlValue(row[c as keyof Row])).join(', ')
  return `INSERT INTO "DictEntry" (${COL_LIST}) VALUES (${values});`
}

/** 生成分片 SQL + apply.sh，供 wrangler 逐片打到线上 D1。 */
async function exportD1() {
  mkdirSync(D1_OUT, { recursive: true })
  const files: string[] = []
  let shard: string[] = []
  let bytes = 0
  let total = 0

  const flush = () => {
    if (shard.length === 0) return
    const name = `dict_${String(files.length + 1).padStart(3, '0')}.sql`
    writeFileSync(join(D1_OUT, name), shard.join('\n') + '\n')
    files.push(name)
    shard = []
    bytes = 0
  }

  // 第一片先清空旧数据，重跑整套分片得到的结果和第一次完全一样。
  shard.push('DELETE FROM "DictEntry";')
  bytes += 32

  for await (const row of readRows()) {
    const stmt = insertStatement(row)
    if (bytes + stmt.length > SHARD_BYTES) flush()
    shard.push(stmt)
    bytes += stmt.length + 1
    total++
  }
  flush()

  const apply = [
    '#!/usr/bin/env bash',
    '# 由 npm run import:dict -- --d1 生成。逐片打到线上 D1。',
    '#',
    '# 用法：',
    '#   bash d1_dict/apply.sh      # 从第 1 片开始：先 DELETE 清空，再整批插入',
    '#   bash d1_dict/apply.sh 42   # 从第 42 片续跑，不重跑 DELETE',
    '#',
    '# 走 npx 调 wrangler：直接 bash 跑时拿不到 npm run 注入的 node_modules/.bin。',
    '# 每片失败自动重试 3 次（5s/10s/20s 退避），用来吃掉 Cloudflare 偶发的',
    '# InternalError。重试用尽会打印续跑命令再退出，已插入的行不受影响。',
    'set -euo pipefail',
    'cd "$(dirname "$0")/.."',
    '',
    `TOTAL=${files.length}`,
    'START="${1:-1}"',
    'DB=word-sprint-db',
    '',
    'apply_shard() {',
    '  local f=$1 attempt=1 delay=5',
    '  until npx wrangler d1 execute "$DB" --remote --file="$f" -y; do',
    '    if [ "$attempt" -ge 3 ]; then return 1; fi',
    '    echo "  ↻ 第 ${attempt} 次失败，${delay}s 后重试…" >&2',
    '    sleep "$delay"',
    '    delay=$(( delay * 2 ))',
    '    attempt=$(( attempt + 1 ))',
    '  done',
    '}',
    '',
    'if [ "$START" -eq 1 ]; then',
    '  echo "先确保建表迁移已应用："',
    `  npx wrangler d1 execute "$DB" --remote --file=./prisma/migrations/${MIGRATION}/migration.sql -y || true`,
    'fi',
    '',
    'i="$START"',
    'while [ "$i" -le "$TOTAL" ]; do',
    '  f=$(printf "./d1_dict/dict_%03d.sql" "$i")',
    '  echo "→ [$i/$TOTAL] $f"',
    '  if ! apply_shard "$f"; then',
    '    echo "✗ $f 重试 3 次仍失败。续跑：bash d1_dict/apply.sh $i" >&2',
    '    exit 1',
    '  fi',
    '  i=$(( i + 1 ))',
    'done',
    '',
    'echo "完成。"',
  ].join('\n')
  writeFileSync(join(D1_OUT, 'apply.sh'), apply + '\n')

  process.stdout.write(`${total.toLocaleString()} 行 → ${files.length} 片，输出 ${D1_OUT}\n`)
  process.stdout.write(`执行：bash d1_dict/apply.sh\n`)
}

/** 灌本地 SQLite。 */
async function importLocal() {
  const prisma = createNodePrismaClient()
  await prisma.dictEntry.deleteMany()

  let batch: Row[] = []
  let total = 0
  const flush = async () => {
    if (batch.length === 0) return
    await prisma.dictEntry.createMany({ data: batch })
    total += batch.length
    batch = []
    process.stdout.write(`\r已导入 ${total.toLocaleString()} 条`)
  }

  for await (const row of readRows()) {
    batch.push(row)
    if (batch.length >= 1000) await flush()
  }
  await flush()

  process.stdout.write(`\n完成，共 ${total.toLocaleString()} 条\n`)
  await prisma.$disconnect()
}

const run = process.argv.includes('--d1') ? exportD1 : importLocal
run().catch((err) => {
  console.error(err)
  process.exit(1)
})
