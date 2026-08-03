/**
 * 合并现有词库与额外 JSONL，并做保守的同源清洗。
 *
 * 不同 source 永不合并；同一 source 内仅合并词头、读音、罗马字和词性均相同的
 * 条目。这样既保留各词典的独立释义，也能消除同一词典拆成多行的重复记录。
 *
 * 用法：
 *   npm run merge:dict -- --input-dir "/path/to/output"
 */
import {
  createReadStream,
  createWriteStream,
  mkdirSync,
  renameSync,
  statSync,
} from 'node:fs'
import { createInterface } from 'node:readline'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pinyin } from 'pinyin-pro'
import { sortKeyFor } from '../../shared/dictSort'

type Direction = 'ja-zh' | 'zh-ja'
type Example = { text: string; translation?: string }
type Sense = { glosses: string[]; examples?: Example[] }
type Entry = {
  word: string
  reading: string
  romaji: string
  pos: string
  senses: Sense[]
  direction: Direction
  source: string
  sortKey: string
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const REPO = join(ROOT, '..')
const OUT_DIR = join(ROOT, 'data', 'dict')
const INDEX_DIR = join(REPO, 'client', 'public', 'dict')
const DIRECTIONS: Direction[] = ['ja-zh', 'zh-ja']
const KANA_HEADWORD = /^[ぁ-ゟァ-ヿー々〆ヵヶ・･\s-]+$/u
const HAS_HAN = /[㐀-鿿豈-﫿]/
const BROKEN_HEADWORD_MARKUP = /\[(?:\/|\*)/

function argValue(name: string): string | undefined {
  const at = process.argv.indexOf(name)
  return at === -1 ? undefined : process.argv[at + 1]
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.normalize('NFC').replace(/\r\n?/g, '\n').trim() : ''
}

/** 这些字段会进入 TSV 索引或作为分组键，不能含换行和制表符。 */
function cleanSingleLine(value: unknown): string {
  return cleanText(value).replace(/[\t\n]+/g, ' ').replace(/ {2,}/g, ' ')
}

function normalizeExamples(value: unknown): Example[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const examples: Example[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue
    const text = cleanText((raw as { text?: unknown }).text)
    if (!text) continue
    const translation = cleanText((raw as { translation?: unknown }).translation)
    const example = translation ? { text, translation } : { text }
    const key = JSON.stringify(example)
    if (!seen.has(key)) {
      seen.add(key)
      examples.push(example)
    }
  }
  return examples
}

function normalizeSenses(value: unknown): Sense[] {
  if (!Array.isArray(value)) return []
  const senses = new Map<string, Sense>()
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue
    const rawGlosses = (raw as { glosses?: unknown }).glosses
    if (!Array.isArray(rawGlosses)) continue

    const glosses: string[] = []
    const seenGlosses = new Set<string>()
    for (const rawGloss of rawGlosses) {
      const gloss = cleanText(rawGloss)
      if (gloss && !seenGlosses.has(gloss)) {
        seenGlosses.add(gloss)
        glosses.push(gloss)
      }
    }
    if (glosses.length === 0) continue

    const key = JSON.stringify(glosses)
    const examples = normalizeExamples((raw as { examples?: unknown }).examples)
    const existing = senses.get(key)
    if (!existing) {
      senses.set(key, examples.length > 0 ? { glosses, examples } : { glosses })
      continue
    }

    const combined = normalizeExamples([...(existing.examples ?? []), ...examples])
    if (combined.length > 0) existing.examples = combined
  }
  return [...senses.values()]
}

function normalizeEntry(raw: unknown, direction: Direction, file: string, lineNo: number): Entry | null {
  if (!raw || typeof raw !== 'object') throw new Error(`${file}:${lineNo}: 不是 JSON 对象`)
  const value = raw as Record<string, unknown>
  if (value.direction !== direction) {
    throw new Error(`${file}:${lineNo}: direction 应为 ${direction}，实际为 ${String(value.direction)}`)
  }

  const word = cleanSingleLine(value.word)
  const source = cleanSingleLine(value.source)
  if (!word) throw new Error(`${file}:${lineNo}: word 为空`)
  if (!source) throw new Error(`${file}:${lineNo}: source 为空，无法保证来源隔离`)
  // 词头里出现关闭标签或 [*] 是源解析器把例句标记错当成了词头。
  if (BROKEN_HEADWORD_MARKUP.test(word)) return null

  let reading = cleanSingleLine(value.reading)
  if (!reading && direction === 'ja-zh' && KANA_HEADWORD.test(word)) reading = word
  if (!reading && direction === 'zh-ja' && HAS_HAN.test(word)) {
    try {
      reading = pinyin(word, { separator: '', nonZh: 'removed', toneType: 'symbol' })
    } catch {
      // 生僻字不在字库时保留空读音，sortKeyFor 会把它稳定沉底。
    }
  }
  const romaji = cleanSingleLine(value.romaji)
  const pos = cleanSingleLine(value.pos) || 'unknown'
  const senses = normalizeSenses(value.senses)
  if (senses.length === 0) return null

  return {
    word,
    reading,
    romaji,
    pos,
    senses,
    direction,
    source,
    sortKey: sortKeyFor(direction, reading, word),
  }
}

function entryKey(entry: Entry): string {
  return JSON.stringify([
    entry.direction,
    entry.source,
    entry.word,
    entry.reading,
    entry.romaji,
    entry.pos,
  ])
}

async function readInto(
  file: string,
  direction: Direction,
  entries: Map<string, Entry>,
): Promise<{ read: number; dropped: number; merged: number }> {
  const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity })
  let read = 0
  let dropped = 0
  let merged = 0
  for await (const line of rl) {
    if (!line.trim()) continue
    read++
    let raw: unknown
    try {
      raw = JSON.parse(line)
    } catch (error) {
      throw new Error(`${file}:${read}: JSON 解析失败`, { cause: error })
    }
    const entry = normalizeEntry(raw, direction, file, read)
    if (!entry) {
      dropped++
      continue
    }
    const key = entryKey(entry)
    const existing = entries.get(key)
    if (!existing) {
      entries.set(key, entry)
      continue
    }
    existing.senses = normalizeSenses([...existing.senses, ...entry.senses])
    merged++
  }
  return { read, dropped, merged }
}

function compareEntries(a: Entry, b: Entry): number {
  const compare = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0)
  return (
    compare(a.sortKey, b.sortKey) ||
    compare(a.word, b.word) ||
    compare(a.reading, b.reading) ||
    compare(a.source, b.source) ||
    compare(a.pos, b.pos) ||
    compare(a.romaji, b.romaji)
  )
}

async function writeLine(stream: ReturnType<typeof createWriteStream>, line: string): Promise<void> {
  if (!stream.write(line)) await new Promise<void>((resolve) => stream.once('drain', resolve))
}

async function closeStream(stream: ReturnType<typeof createWriteStream>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    stream.on('error', reject)
    stream.end(resolve)
  })
}

async function writeOutputs(direction: Direction, entries: Entry[]): Promise<number> {
  mkdirSync(OUT_DIR, { recursive: true })
  mkdirSync(INDEX_DIR, { recursive: true })
  const jsonl = join(OUT_DIR, `${direction}.jsonl`)
  const index = join(INDEX_DIR, `${direction}.idx`)
  const jsonlTmp = `${jsonl}.tmp`
  const indexTmp = `${index}.tmp`
  const jsonlStream = createWriteStream(jsonlTmp)
  const indexStream = createWriteStream(indexTmp)
  const seenIndex = new Set<string>()
  let indexRows = 0

  for (const entry of entries) {
    await writeLine(jsonlStream, `${JSON.stringify(entry)}\n`)
    // 索引只是导航：同表记同读音只出现一次，详情查询仍返回所有 source。
    const indexKey = JSON.stringify([entry.word, entry.sortKey])
    if (!seenIndex.has(indexKey)) {
      seenIndex.add(indexKey)
      await writeLine(indexStream, `${entry.sortKey}\t${entry.word}\t${entry.reading}\n`)
      indexRows++
    }
  }

  await Promise.all([closeStream(jsonlStream), closeStream(indexStream)])
  renameSync(jsonlTmp, jsonl)
  renameSync(indexTmp, index)
  return indexRows
}

async function main() {
  const inputDir = argValue('--input-dir')
  if (!inputDir) throw new Error('缺少 --input-dir /path/to/output')

  for (const direction of DIRECTIONS) {
    const entries = new Map<string, Entry>()
    const current = join(OUT_DIR, `${direction}.jsonl`)
    const added = join(inputDir, `${direction}.jsonl`)
    const currentStats = await readInto(current, direction, entries)
    const addedStats = await readInto(added, direction, entries)
    const sorted = [...entries.values()].sort(compareEntries)
    const indexRows = await writeOutputs(direction, sorted)
    const sizeMb = (statSync(current).size / 1_000_000).toFixed(1)

    process.stdout.write(
      [
        `${direction}: ${currentStats.read.toLocaleString()} + ${addedStats.read.toLocaleString()}`,
        `→ ${sorted.length.toLocaleString()} 条`,
        `同源合并 ${(currentStats.merged + addedStats.merged).toLocaleString()} 条`,
        `过滤无效条目 ${(currentStats.dropped + addedStats.dropped).toLocaleString()} 条`,
        `索引 ${indexRows.toLocaleString()} 行`,
        `${sizeMb} MB`,
      ].join('，') + '\n',
    )
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
