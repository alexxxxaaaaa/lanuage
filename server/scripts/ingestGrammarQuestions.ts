/**
 * Ingest generated N1 grammar MCQs into the remote D1 GrammarQuestion table.
 *
 * Reads every batch JSON file matching `server/data/grammarQuestions/batch-*.json`,
 * writes one big SQL file with INSERT OR IGNORE statements, and pipes it into
 * `wrangler d1 execute --remote --file ...`.
 *
 * Batch JSON schema:
 *   [
 *     { "grammarId": "<uuid>", "prompt": "…（　）…", "options": ["a","b","c","d"], "answerIndex": 2 },
 *     ...
 *   ]
 *
 * Usage:
 *   node --import tsx server/scripts/ingestGrammarQuestions.ts
 *   node --import tsx server/scripts/ingestGrammarQuestions.ts --dry-run
 */
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

type Question = {
  grammarId: string
  prompt: string
  options: string[]
  answerIndex: number
}

const HERE = dirname(fileURLToPath(import.meta.url))
const BATCH_DIR = join(HERE, '..', 'data', 'grammarQuestions')
const OUT_SQL = join(BATCH_DIR, '_generated_insert.sql')
const DRY = process.argv.includes('--dry-run')

function sqlEscape(value: string) {
  return value.replace(/'/g, "''")
}

async function main() {
  const files = (await readdir(BATCH_DIR))
    .filter((f) => f.startsWith('batch-') && f.endsWith('.json'))
    .sort()
  if (files.length === 0) {
    console.error(`No batch-*.json files in ${BATCH_DIR}`)
    process.exit(2)
  }
  const all: Question[] = []
  for (const f of files) {
    const raw = await readFile(join(BATCH_DIR, f), 'utf8')
    const rows = JSON.parse(raw) as Question[]
    for (const r of rows) {
      if (
        typeof r.grammarId !== 'string' ||
        typeof r.prompt !== 'string' ||
        !Array.isArray(r.options) ||
        r.options.length !== 4 ||
        r.options.some((v) => typeof v !== 'string') ||
        !Number.isInteger(r.answerIndex) ||
        r.answerIndex < 0 ||
        r.answerIndex > 3
      ) {
        throw new Error(`bad row in ${f}: ${JSON.stringify(r).slice(0, 160)}`)
      }
    }
    all.push(...rows)
    console.log(`  ${f}: ${rows.length}`)
  }
  console.log(`total questions: ${all.length}`)

  const stmts: string[] = []
  for (const q of all) {
    const id = randomUUID()
    stmts.push(
      `INSERT INTO GrammarQuestion (id, grammarId, prompt, options, answerIndex)` +
        ` VALUES ('${id}', '${sqlEscape(q.grammarId)}', '${sqlEscape(q.prompt)}',` +
        ` '${sqlEscape(JSON.stringify(q.options))}', ${q.answerIndex});`,
    )
  }
  await writeFile(OUT_SQL, stmts.join('\n') + '\n', 'utf8')
  console.log(`wrote ${stmts.length} INSERTs to ${OUT_SQL}`)

  if (DRY) {
    console.log('dry-run — not applying')
    return
  }

  console.log('applying to remote D1…')
  execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', 'word-sprint-db', '--remote', '--file', OUT_SQL],
    { stdio: 'inherit', cwd: join(HERE, '..') },
  )
  console.log('done.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
