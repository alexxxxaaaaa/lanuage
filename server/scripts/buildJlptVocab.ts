/**
 * 生成 JLPT 词汇级别表 client/public/dict/jlpt.tsv。
 *
 * 两个来源，级别取并集 —— 官方从 2010 年改版起就不再公布词表，市面上所有
 * N1〜N5 词表都是估计值，两家对同一个词判不同级别很常见，都留着比替谁挑一个诚实。
 *
 *   A. 日本語能力試験出題基準語彙表（旧试验 1〜4 級，最后一份官方词表）
 *      https://www7a.biglobe.ne.jp/nifongo/data/noryoku.html
 *      取同页提供的 TSV 下载（UTF-16LE + CRLF），比解析 1.6 MB 的 HTML 表格稳。
 *      級別数字直译成 N1〜N4；0 表示基准表未收录，跳过。
 *      词形取「漢字・原文」列 —— 没有汉字的词那一列本来就重复了假名写法，所以它
 *      同时覆盖汉字词和纯假名词。只有片假名外来语例外：那一列放的是原文
 *      （アイスクリーム → icecream），这时改取「語」列。
 *
 *   B. Jonathan Waller《JLPT Resources》(CC BY) http://www.tanos.co.uk/jlpt/
 *      jisho.org 的 JLPT 标签用的就是这份，原生分 N1〜N5（A 那份没有 N5）。
 *      经 https://github.com/stephenmk/yomitan-jlpt-vocab 用 JMdict 校正过词形
 *      （歯磨 → 歯磨き 这类罕见写法换成常用写法），比原始列表更容易和词库对上。
 *      词形取汉字列，纯假名词取假名列 —— 和 A 的口径一致。
 *
 * 产物每行 `词形 \t 级别数字串`，按词形排序；`#` 开头是署名，客户端解析时
 * 因为没有制表符自然跳过：
 *   勉強	45      ← 两源分别判 N4 / N5，都留
 *   東	15        ← ひがし 是 N5、あずま 是 N1，同形不同读音，也都留
 *
 * 用法：
 *   npm run build:jlpt                 # 缺源文件时自动下载到 .dictcache/
 *   npm run build:jlpt -- --force-download
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const REPO = join(ROOT, '..')
const CACHE_DIR = join(ROOT, '.dictcache')
const OUT_FILE = join(REPO, 'client', 'public', 'dict', 'jlpt.tsv')

const KIJUN_URL = 'https://www7a.biglobe.ne.jp/nifongo/data/noryoku.txt.gz'
const WALLER_URL =
  'https://raw.githubusercontent.com/stephenmk/yomitan-jlpt-vocab/main/original_data'

/** 写进产物开头的署名。CC BY 要求随作品传播，这个文件是直接发给浏览器的。 */
const ATTRIBUTION = [
  '# JLPT 词汇级别表 —— server/scripts/buildJlptVocab.ts 生成，勿手改。',
  '# 出題基準語彙表 https://www7a.biglobe.ne.jp/nifongo/data/noryoku.html',
  '# JLPT Resources by Jonathan Waller (CC BY) http://www.tanos.co.uk/jlpt/',
  '#   词形经 https://github.com/stephenmk/yomitan-jlpt-vocab 按 JMdict 校正',
]

/** 假名或汉字。用来分辨「漢字・原文」列到底是日语写法还是外来语原文。 */
const HAS_JAPANESE = /[぀-ヿ㐀-鿿]/
const KANA_ONLY = /^[ぁ-ゟァ-ヿー]+$/

/** 并列写法的分隔，源数据里全角半角混用：美味い、旨い//上手い、巧い。 */
const VARIANT = /[/／、，；;]+/
/** 送り仮名并記与词缀接续：応じる・応ずる、咄嗟・に。 */
const JOINT = /[・･‧．.]/

/** 用例语境 `「…」` 不是词形的一部分，而且会嵌套：遣る「「あげる」の意味」。 */
function stripContext(field: string): string {
  let out = field
  for (let previous = ''; previous !== out; ) {
    previous = out
    out = out.replace(/「[^「」]*」/g, '')
  }
  return out
}

/** 展开 `（…）` 可选段：あいさつ（する）→ あいさつする / あいさつ。 */
function expandOptional(text: string): string[] {
  const at = text.indexOf('（')
  const end = at === -1 ? -1 : text.indexOf('）', at)
  if (end === -1) return [text]
  const head = text.slice(0, at)
  const tail = text.slice(end + 1)
  return [
    ...expandOptional(head + text.slice(at + 1, end) + tail),
    ...expandOptional(head + tail),
  ]
}

/**
 * 出題基準的一格原文 → 若干个可查的词形。
 *
 * 格子里的标记：`「…」` 是用例语境（case「場合・状況」），`〜` 是词缀位，
 * `-` 是词素分隔（失礼-します），`。` 是寒暄语的句号，都不进词形。
 */
function surfaceForms(field: string): string[] {
  const forms = new Set<string>()
  // 先展开可选段再切并列：反过来的话 `（どうぞ，）宜しく` 里那个逗号会把括号切断。
  const pieces = expandOptional(stripContext(field)).flatMap((piece) => piece.split(VARIANT))

  for (const piece of pieces) {
    const text = piece.replace(/[〜～\-。]/g, '').trim()
    if (!text) continue

    const parts = text.split(JOINT).filter(Boolean)
    if (parts.length < 2) {
      forms.add(text)
      continue
    }
    // `・` 两侧既可能是并列写法（生ける・活ける = 两个词），也可能是接续
    // （咄嗟・に = 咄嗟に）。两种都收下，多出来的那个词形不存在于词库，
    // 查不到也就不会显示。
    forms.add(parts.join(''))
    for (const part of parts) {
      // 只是送り仮名的那一半（重んじる・ずる 里的「ずる」）不是词。
      if (KANA_ONLY.test(part) && part.length <= 2) continue
      forms.add(part)
    }
  }
  return [...forms]
}

async function download(url: string, name: string, force: boolean): Promise<Buffer> {
  const file = join(CACHE_DIR, name)
  if (!force && existsSync(file)) return readFileSync(file)

  process.stdout.write(`↓ ${url}\n`)
  const response = await fetch(url)
  if (!response.ok) throw new Error(`下载失败：${response.status} ${response.statusText} ${url}`)
  const buffer = Buffer.from(await response.arrayBuffer())
  mkdirSync(CACHE_DIR, { recursive: true })
  writeFileSync(file, buffer)
  return buffer
}

type Tag = (form: string, level: number) => void

/** 源 A：出題基準語彙表。返回收下的行数。 */
function collectKijun(gzipped: Buffer, tag: Tag): number {
  const tsv = new TextDecoder('utf-16le').decode(gunzipSync(gzipped))
  let rows = 0

  // 第一行是表头（語 / 級別 / 舊 / 漢字・原文 / …）。
  for (const line of tsv.split('\n').slice(1)) {
    const columns = line.replace(/\r$/, '').split('\t')
    if (columns.length < 4) continue
    const [kana, rawLevel, , original] = columns

    const level = Number(rawLevel)
    if (!Number.isInteger(level) || level < 1 || level > 4) continue
    rows++

    const isLoanword = !HAS_JAPANESE.test(stripContext(original))
    for (const form of surfaceForms(isLoanword ? kana : original)) {
      // 汉日混排的格子（jet；ジェット機）里，原文那一半不是日语词形。
      if (HAS_JAPANESE.test(form)) tag(form, level)
    }
  }
  return rows
}

/** 源 B：Waller 词表的一个级别。列是 `jmdict_seq,kana,kanji,definition`。 */
function collectWaller(csv: string, level: number, tag: Tag): number {
  let rows = 0
  for (const line of csv.split('\n').slice(1)) {
    // 释义列带引号和逗号，但前三列不会，朴素切分取到 kanji 就够。
    const [, kana = '', kanji = ''] = line.split(',')
    const form = (kanji.trim() || kana.trim()).trim()
    if (!form) continue
    rows++
    tag(form, level)
  }
  return rows
}

async function main(force: boolean) {
  const levels = new Map<string, Set<number>>()
  const tag: Tag = (form, level) => {
    const seen = levels.get(form)
    if (seen) seen.add(level)
    else levels.set(form, new Set([level]))
  }

  const kijunRows = collectKijun(await download(KIJUN_URL, 'noryoku.txt.gz', force), tag)
  process.stdout.write(`出題基準 ${kijunRows.toLocaleString()} 行 → 词形 ${levels.size}\n`)

  const before = levels.size
  let wallerRows = 0
  for (const level of [1, 2, 3, 4, 5]) {
    const csv = await download(`${WALLER_URL}/n${level}.csv`, `waller-n${level}.csv`, force)
    wallerRows += collectWaller(csv.toString('utf8'), level, tag)
  }
  process.stdout.write(
    `Waller ${wallerRows.toLocaleString()} 行 → 新增词形 ${levels.size - before}\n`,
  )

  const lines = [...levels]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([form, set]) => `${form}\t${[...set].sort().join('')}`)
  const content = [...ATTRIBUTION, ...lines].join('\n') + '\n'
  mkdirSync(dirname(OUT_FILE), { recursive: true })
  writeFileSync(OUT_FILE, content)

  const multi = [...levels.values()].filter((set) => set.size > 1).length
  process.stdout.write(
    `合计词形 ${lines.length.toLocaleString()}，其中跨级别 ${multi.toLocaleString()}\n` +
      `  ${OUT_FILE} (${(Buffer.byteLength(content) / 1000).toFixed(0)} KB)\n`,
  )
}

main(process.argv.includes('--force-download')).catch((error) => {
  console.error(error)
  process.exit(1)
})
