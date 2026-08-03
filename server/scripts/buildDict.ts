/**
 * 从 Wiktextract 抽取日中 / 中日词库。
 *
 * 数据源（两者都原生支持所需方向，不做跨语言桥接）：
 *   日中 ← 中文维基词典里的日语词条   (kaikki zh-extract, lang_code === 'ja')
 *   中日 ← 日语维基词典里的中文词条   (kaikki ja-extract, lang_code === 'zh')
 *
 * JMdict 未采用：218,290 条词条里只有 293 条中文 gloss，不是原生日中词典。
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

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CACHE_DIR = join(ROOT, '.dictcache')
const OUT_DIR = join(ROOT, 'data', 'dict')

const SOURCES = [
  { file: 'zh-extract.jsonl.gz', url: 'https://kaikki.org/dictionary/downloads/zh/zh-extract.jsonl.gz' },
  { file: 'ja-extract.jsonl.gz', url: 'https://kaikki.org/dictionary/downloads/ja/ja-extract.jsonl.gz' },
]

/** 词库条目 —— 与 Prisma 的 DictEntry 字段对齐。 */
type Sense = {
  glosses: string[]
  examples?: { text: string; translation?: string }[]
}
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
}

/** soft-redirect 是跳转壳，romanization 是罗马字异形词头，都不是真词条。 */
const SKIP_POS = new Set(['soft-redirect', 'romanization'])

const KANA_ONLY = /^[ぁ-ゟァ-ヿー々]+$/

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

type ExtractOptions = {
  srcFile: string
  /** 只保留这个语言的词条。 */
  langCode: 'ja' | 'zh'
  direction: Entry['direction']
  source: Entry['source']
  outFile: string
}

async function extract(opts: ExtractOptions) {
  const src = join(CACHE_DIR, opts.srcFile)
  const out = join(OUT_DIR, opts.outFile)
  const sink = createWriteStream(out)

  const rl = createInterface({
    input: createReadStream(src).pipe(createGunzip()),
    crlfDelay: Infinity,
  })

  let scanned = 0
  let kept = 0
  let withReading = 0
  const posCount = new Map<string, number>()

  for await (const line of rl) {
    if (!line) continue
    scanned++

    let raw: any
    try {
      raw = JSON.parse(line)
    } catch {
      continue
    }

    if (raw.lang_code !== opts.langCode) continue
    const pos: string = raw.pos ?? 'unknown'
    if (SKIP_POS.has(pos)) continue

    const word: string = (raw.word ?? '').trim()
    if (!word) continue

    const { senses, recoveredReading, looseFallback } = normalizeSenses(raw, word)
    if (senses.length === 0) continue

    const reading =
      opts.langCode === 'ja'
        ? japaneseReading(raw) || recoveredReading || looseFallback
        : mandarinPinyin(raw)

    const entry: Entry = {
      word,
      reading,
      romaji: opts.langCode === 'ja' ? japaneseRomaji(raw) : '',
      pos,
      senses,
      direction: opts.direction,
      source: opts.source,
    }
    if (reading) withReading++

    if (!sink.write(JSON.stringify(entry) + '\n')) {
      await new Promise((resolve) => sink.once('drain', resolve))
    }
    kept++
    posCount.set(pos, (posCount.get(pos) ?? 0) + 1)
  }

  await new Promise((resolve) => sink.end(resolve))

  return { scanned, kept, withReading, out, posCount }
}

async function main() {
  mkdirSync(CACHE_DIR, { recursive: true })
  mkdirSync(OUT_DIR, { recursive: true })

  const force = process.argv.includes('--force-download')
  for (const { file, url } of SOURCES) {
    const dest = join(CACHE_DIR, file)
    if (force || !existsSync(dest)) await download(url, dest)
    else process.stdout.write(`✓ 已缓存 ${file} (${(statSync(dest).size / 1e6).toFixed(0)} MB)\n`)
  }

  const jobs: ExtractOptions[] = [
    {
      srcFile: 'zh-extract.jsonl.gz',
      langCode: 'ja',
      direction: 'ja-zh',
      source: 'zhwiktionary',
      outFile: 'ja-zh.jsonl',
    },
    {
      srcFile: 'ja-extract.jsonl.gz',
      langCode: 'zh',
      direction: 'zh-ja',
      source: 'jawiktionary',
      outFile: 'zh-ja.jsonl',
    },
  ]

  for (const job of jobs) {
    process.stdout.write(`\n— 抽取 ${job.direction} —\n`)
    const r = await extract(job)
    const top = [...r.posCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
    const pct = ((r.withReading / r.kept) * 100).toFixed(1)
    process.stdout.write(`扫描 ${r.scanned.toLocaleString()} 行 → 保留 ${r.kept.toLocaleString()} 条\n`)
    process.stdout.write(`读音/拼音覆盖: ${r.withReading.toLocaleString()} (${pct}%)\n`)
    process.stdout.write(`词性分布: ${top.map(([p, n]) => `${p}=${n}`).join(' ')}\n`)
    process.stdout.write(`输出 ${r.out} (${(statSync(r.out).size / 1e6).toFixed(1)} MB)\n`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
