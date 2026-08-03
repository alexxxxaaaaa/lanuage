/**
 * 从 Wiktextract 抽取日中 / 中日词库。
 *
 * 数据源（两者都原生支持所需方向，不做跨语言桥接）：
 *   日中 ← 中文维基词典里的日语词条   (kaikki zh-extract, lang_code === 'ja')
 *   中日 ← 日语维基词典里的中文词条   (kaikki ja-extract, lang_code === 'zh')
 *
 * JMdict 未采用：218,290 条词条里只有 293 条中文 gloss，不是原生日中词典。
 *
 * 产物：
 *   server/data/dict/<dir>.jsonl.gz  完整词条（gzip，见 dictFile.ts），供 importDict.ts 灌进 D1
 *   client/public/dict/<dir>.idx     仅词头/读音的索引，随前端发布给右侧索引栏用
 *
 * 用法：
 *   npm run build:dict          # 缺源文件时自动下载到 .dictcache/
 *   npm run build:dict -- --force-download
 */
import { createReadStream, createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs'
import { createGunzip } from 'node:zlib'
import { createInterface } from 'node:readline'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pinyin } from 'pinyin-pro'
import { sortKeyFor } from '../../shared/dictSort'
import { dictFileFor, openDictWriter } from './dictFile'
import {
  enrichZhWiktionarySenses,
  getJapaneseTokenizer,
  inferJapaneseReading,
  type DictSense,
} from './dictEnrichment'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const REPO = join(ROOT, '..')
const CACHE_DIR = join(ROOT, '.dictcache')
const OUT_DIR = join(ROOT, 'data', 'dict')
const INDEX_DIR = join(REPO, 'client', 'public', 'dict')

const SOURCES = [
  { file: 'zh-extract.jsonl.gz', url: 'https://kaikki.org/dictionary/downloads/zh/zh-extract.jsonl.gz' },
  { file: 'ja-extract.jsonl.gz', url: 'https://kaikki.org/dictionary/downloads/ja/ja-extract.jsonl.gz' },
]

/** 词库条目 —— 与 Prisma 的 DictEntry 字段对齐。 */
type Sense = DictSense
type Entry = {
  word: string
  /** 日中为假名读音，中日为官話拼音。 */
  reading: string
  /** 日中为罗马字，中日留空。 */
  romaji: string
  pos: string
  senses: Sense[]
  direction: 'ja-zh' | 'zh-ja'
  source: 'zhwiktionary' | 'jawiktionary'
  /** 五十音順 / 拼音序的排序键，客户端索引二分查找也用它。 */
  sortKey: string
}

/** soft-redirect 是跳转壳，romanization 是罗马字异形词头，都不是真词条。 */
const SKIP_POS = new Set(['soft-redirect', 'romanization'])

const KANA_ONLY = /^[ぁ-ゟァ-ヿー々]+$/
const HAS_HAN = /[㐀-鿿豈-﫿]/

/**
 * 用 canonical form 的 ruby 重建正字法读音。
 * ruby 只覆盖汉字段，段间假名原样保留：食べる + [[食,た]] → たべる。
 * 比 sounds[].other 更适合词库 —— 后者是音声表记，长音写成 ー（かいとー）。
 */
function readingFromRuby(word: string, ruby: [string, string][]): string {
  let rest = word
  let out = ''
  for (const [kanji, kana] of ruby) {
    const at = rest.indexOf(kanji)
    if (at === -1) return ''
    out += rest.slice(0, at) + kana
    rest = rest.slice(at + kanji.length)
  }
  return out + rest
}

function japaneseReading(raw: any): string {
  const word: string = raw.word ?? ''
  if (KANA_ONLY.test(word)) return word

  const canonical = (raw.forms ?? []).find(
    (f: any) => f?.tags?.includes('canonical') && Array.isArray(f.ruby) && f.ruby.length > 0,
  )
  if (canonical) {
    const rebuilt = readingFromRuby(canonical.form ?? word, canonical.ruby)
    if (rebuilt) return rebuilt
  }

  // 兜底：音声表记，长音是 ー 而非 う/お。
  const other = (raw.sounds ?? []).find((s: any) => typeof s?.other === 'string')
  return other?.other ?? ''
}

function japaneseRomaji(raw: any): string {
  const form = (raw.forms ?? []).find((f: any) => f?.tags?.includes('romanization'))
  return form?.form ?? ''
}

/**
 * sounds 里混着粤语/客家/闽南/中古音/上古音，只取官話拼音。
 * 拼音有两种标注法：raw_tags ['官話','拼音'] 与 tags ['Pinyin']，都要认。
 */
function mandarinPinyin(raw: any): string {
  const sounds = raw.sounds ?? []
  const hit =
    sounds.find((s: any) => s?.raw_tags?.includes('拼音') && s?.raw_tags?.includes('官話')) ??
    sounds.find((s: any) => s?.tags?.includes('Pinyin'))
  const pron: string = hit?.zh_pron ?? ''
  // 中古音/上古音条目会把整段考据塞进 zh_pron，带换行和星号，直接丢弃。
  return pron.includes('\n') || pron.startsWith('*') ? '' : pron.trim()
}

/**
 * 日语维基词典只给 33.9% 的中文词条标了读音，剩下三分之二没有 sounds 字段。
 * 拼音序索引要是缺了这些词就废了，所以构建期用 pinyin-pro 补齐 ——
 * 它按词组消歧多音字（「行」在「银行」读 háng、「行动」读 xíng），
 * 比逐字查表准。只在构建期跑，拼音直接烤进数据，运行时没有这个依赖。
 */
function fillPinyin(word: string): string {
  if (!HAS_HAN.test(word)) return ''
  try {
    return pinyin(word, { separator: '', nonZh: 'removed', toneType: 'symbol' })
  } catch {
    return ''
  }
}

/**
 * 中文维基词典把整个词条段落压进单个 gloss，形如：
 *   大臣【だいじん】\n大臣。
 *   整理【せいり】\n名·他サ\n1. 整理，收拾。\n2. 清理，处理。
 * 开头的「词头【假名】」既是读音来源，也是该从释义里剥掉的噪音。
 */
const KANA_RUN = '[ぁ-ゟァ-ヿー]'
const READING_PREFIX = new RegExp(`^(.+?)【(${KANA_RUN}+)】[ \\t]*\\n?`)

function splitReadingPrefix(word: string, gloss: string): { reading: string; rest: string } {
  const m = gloss.match(READING_PREFIX)
  // 必须紧跟在词头之后才是读音；【上代語】这类标签不是。
  if (!m || m[1].trim() !== word) return { reading: '', rest: gloss }
  return { reading: m[2], rest: gloss.slice(m[0].length) }
}

/**
 * 旧字体词头（殘忍/就學/禮服）的释义写成「新字体【读音】」或「〈新字体〉【读音】」，
 * 前缀对不上词头所以严格匹配会漏。只在其它途径都拿不到读音时兜底，
 * 且不剥掉这行 —— 它记录的字体异形本身是有用信息。
 */
const LOOSE_READING = new RegExp(`^[^【\\n]{0,8}【(${KANA_RUN}+)】`)

function looseReading(gloss: string): string {
  return gloss.match(LOOSE_READING)?.[1] ?? ''
}

/**
 * 归一化释义。副作用返回从 gloss 前缀里回收到的读音 ——
 * 约三分之一的日语词条只有这一处记录读音。
 */
function normalizeSenses(
  raw: any,
  word: string,
): { senses: Sense[]; recoveredReading: string; looseFallback: string } {
  const senses: Sense[] = []
  let recoveredReading = ''
  let looseFallback = ''

  for (const sense of raw.senses ?? []) {
    const glosses: string[] = []
    for (const gloss of sense.glosses ?? []) {
      if (typeof gloss !== 'string') continue
      const { reading, rest } = splitReadingPrefix(word, gloss)
      if (reading && !recoveredReading) recoveredReading = reading
      if (!looseFallback) looseFallback = looseReading(gloss)
      // 压缩进单串的段落按行拆开，逐行才是可渲染的释义单位。
      for (const line of rest.split('\n')) {
        const text = line.trim()
        if (text) glosses.push(text)
      }
    }
    if (glosses.length === 0) continue

    const examples = (sense.examples ?? [])
      .map((ex: any) => {
        const text = (ex.text ?? '').trim()
        if (!text) return null
        const translation = (ex.translation ?? ex.bold_translation ?? '').trim()
        return translation ? { text, translation } : { text }
      })
      .filter(Boolean) as Sense['examples']

    senses.push(examples && examples.length > 0 ? { glosses, examples } : { glosses })
  }
  return { senses, recoveredReading, looseFallback }
}

async function download(url: string, dest: string) {
  process.stdout.write(`↓ ${url}\n`)
  const res = await fetch(url)
  if (!res.ok || !res.body) throw new Error(`下载失败 ${res.status}: ${url}`)
  await pipeline(Readable.fromWeb(res.body as any), createWriteStream(dest))
}

type Job = {
  srcFile: string
  /** 只保留这个语言的词条。 */
  langCode: 'ja' | 'zh'
  direction: Entry['direction']
  source: Entry['source']
}

async function extract(job: Job): Promise<Entry[]> {
  const rl = createInterface({
    input: createReadStream(join(CACHE_DIR, job.srcFile)).pipe(createGunzip()),
    crlfDelay: Infinity,
  })

  const entries: Entry[] = []
  for await (const line of rl) {
    if (!line) continue

    let raw: any
    try {
      raw = JSON.parse(line)
    } catch {
      continue
    }

    if (raw.lang_code !== job.langCode) continue
    const pos: string = raw.pos ?? 'unknown'
    if (SKIP_POS.has(pos)) continue

    const word: string = (raw.word ?? '').trim()
    if (!word) continue

    const { senses: normalizedSenses, recoveredReading, looseFallback } = normalizeSenses(raw, word)
    const enriched = job.source === 'zhwiktionary'
      ? enrichZhWiktionarySenses(pos, normalizedSenses, word)
      : { pos, senses: normalizedSenses }
    const senses = enriched.senses
    if (senses.length === 0) continue

    let reading =
      job.langCode === 'ja'
        ? japaneseReading(raw) || recoveredReading || looseFallback
        : mandarinPinyin(raw) || fillPinyin(word)
    if (job.langCode === 'ja' && !reading) {
      reading = inferJapaneseReading(await getJapaneseTokenizer(), word)
    }

    entries.push({
      word,
      reading,
      romaji: job.langCode === 'ja' ? japaneseRomaji(raw) : '',
      pos: enriched.pos,
      senses,
      direction: job.direction,
      source: job.source,
      sortKey: sortKeyFor(job.direction, reading, word),
    })
  }

  // 五十音順 / 拼音序。键相同时按词头兜底，保证顺序完全确定 ——
  // 否则每次重建索引里同音词的位置都会漂移，客户端缓存跟着失效。
  entries.sort(
    (a, b) =>
      (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0) ||
      (a.word < b.word ? -1 : a.word > b.word ? 1 : 0),
  )
  return entries
}

async function writeJsonl(entries: Entry[], file: string) {
  const sink = openDictWriter(file)
  for (const entry of entries) {
    await sink.write(JSON.stringify(entry) + '\n')
  }
  await sink.close()
}

/**
 * 索引只带定位和显示所需的三列：sortKey \t 词头 \t 读音。
 * 词条详情走 D1 按需取，不进这个文件。
 *
 * sortKey 显式写进文件而不是让客户端从读音重算 —— 客户端只需要归一化
 * 用户输入，不必和构建期的规则逐字符对齐，两边实现漂移也只会让定位差
 * 几行，不会把整个列表的顺序搞错。
 */
async function writeIndex(entries: Entry[], file: string) {
  const sink = createWriteStream(file)
  const seen = new Set<string>()
  let rows = 0
  for (const entry of entries) {
    // 同表記異音語（行 = いく / ぎょう / こう）在辞书里本就是分立词条，
    // 按 词头+排序键 去重，各自留在自己的读音位置上。
    const key = `${entry.word} ${entry.sortKey}`
    if (seen.has(key)) continue
    seen.add(key)
    if (!sink.write(`${entry.sortKey}\t${entry.word}\t${entry.reading}\n`)) {
      await new Promise((resolve) => sink.once('drain', resolve))
    }
    rows++
  }
  await new Promise((resolve) => sink.end(resolve))
  return rows
}

const JOBS: Job[] = [
  { srcFile: 'zh-extract.jsonl.gz', langCode: 'ja', direction: 'ja-zh', source: 'zhwiktionary' },
  { srcFile: 'ja-extract.jsonl.gz', langCode: 'zh', direction: 'zh-ja', source: 'jawiktionary' },
]

async function main() {
  mkdirSync(CACHE_DIR, { recursive: true })
  mkdirSync(OUT_DIR, { recursive: true })
  mkdirSync(INDEX_DIR, { recursive: true })

  const force = process.argv.includes('--force-download')
  for (const { file, url } of SOURCES) {
    const dest = join(CACHE_DIR, file)
    if (force || !existsSync(dest)) await download(url, dest)
    else process.stdout.write(`✓ 已缓存 ${file} (${(statSync(dest).size / 1e6).toFixed(0)} MB)\n`)
  }

  const mb = (f: string) => `${(statSync(f).size / 1e6).toFixed(1)} MB`

  for (const job of JOBS) {
    process.stdout.write(`\n— ${job.direction} —\n`)
    const entries = await extract(job)

    const jsonl = dictFileFor(OUT_DIR, job.direction)
    const idx = join(INDEX_DIR, `${job.direction}.idx`)
    await writeJsonl(entries, jsonl)
    const rows = await writeIndex(entries, idx)

    const withReading = entries.filter((e) => e.reading).length
    const pct = ((withReading / entries.length) * 100).toFixed(1)
    process.stdout.write(`词条 ${entries.length.toLocaleString()} 条，读音覆盖 ${pct}%\n`)
    process.stdout.write(`  ${jsonl} (${mb(jsonl)})\n`)
    process.stdout.write(`  ${idx} (${mb(idx)}, ${rows.toLocaleString()} 行)\n`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
