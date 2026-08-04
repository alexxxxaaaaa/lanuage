/**
 * 生成 JLPT 词汇级别表 client/public/dict/jlpt.tsv。
 *
 * 数据源：日本語能力試験出題基準語彙表（内山和也 编整，凡人社《出題基準【改訂版】》）
 *   https://www7a.biglobe.ne.jp/nifongo/data/noryoku.html
 * 取的是同页提供的 TSV 下载 noryoku.txt.gz（UTF-16LE + CRLF），比抓 1.6 MB 的
 * HTML 表格稳。
 *
 * 「級別」列是旧试验的 1〜4 级，这里按数字直译成 N1〜N4；0 表示基准表未收录，跳过。
 *
 * 词形取「漢字・原文」列 —— 没有汉字的词那一列本来就重复了假名写法，所以它同时
 * 覆盖汉字词和纯假名词。只有片假名外来语例外：那一列放的是原文
 * （アイスクリーム → icecream），这时改取「語」列。
 *
 * 产物每行 `词形 \t 级别数字串`，按词形排序：
 *   あいさつ	3
 *   後	24        ← 同一词形跨级别的约 170 个词并排收全，前端并排展示 N2 N4
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
const SOURCE_URL = 'https://www7a.biglobe.ne.jp/nifongo/data/noryoku.txt.gz'
const CACHE_FILE = join(ROOT, '.dictcache', 'noryoku.txt.gz')
const OUT_FILE = join(REPO, 'client', 'public', 'dict', 'jlpt.tsv')

/** 假名或汉字。用来分辨「原文」列到底是日语写法还是外来语原文。 */
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
 * 一格原文 → 若干个可查的词形。
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

async function fetchSource(force: boolean): Promise<Buffer> {
  if (!force && existsSync(CACHE_FILE)) {
    process.stdout.write(`✓ 已缓存 ${CACHE_FILE}\n`)
    return readFileSync(CACHE_FILE)
  }
  process.stdout.write(`↓ ${SOURCE_URL}\n`)
  const response = await fetch(SOURCE_URL)
  if (!response.ok) throw new Error(`下载失败：${response.status} ${response.statusText}`)
  const buffer = Buffer.from(await response.arrayBuffer())
  mkdirSync(dirname(CACHE_FILE), { recursive: true })
  writeFileSync(CACHE_FILE, buffer)
  return buffer
}

function main(gzipped: Buffer) {
  const tsv = new TextDecoder('utf-16le').decode(gunzipSync(gzipped))
  const levels = new Map<string, Set<number>>()
  let rows = 0
  let skipped = 0

  // 第一行是表头（語 / 級別 / 舊 / 漢字・原文 / …）。
  for (const line of tsv.split('\n').slice(1)) {
    const columns = line.replace(/\r$/, '').split('\t')
    if (columns.length < 4) continue
    const [kana, rawLevel, , original] = columns

    const level = Number(rawLevel)
    if (!Number.isInteger(level) || level < 1 || level > 4) {
      skipped++
      continue
    }
    rows++

    const isLoanword = !HAS_JAPANESE.test(stripContext(original))
    for (const form of surfaceForms(isLoanword ? kana : original)) {
      // 汉日混排的格子（jet；ジェット機）里，原文那一半不是日语词形。
      if (!HAS_JAPANESE.test(form)) continue
      const seen = levels.get(form)
      if (seen) seen.add(level)
      else levels.set(form, new Set([level]))
    }
  }

  mkdirSync(dirname(OUT_FILE), { recursive: true })
  const lines = [...levels]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([form, set]) => `${form}\t${[...set].sort().join('')}`)
  writeFileSync(OUT_FILE, lines.join('\n') + '\n')

  const multi = [...levels.values()].filter((set) => set.size > 1).length
  process.stdout.write(
    `词条 ${rows.toLocaleString()} 行（跳过未收录 ${skipped}）` +
      ` → 词形 ${lines.length.toLocaleString()} 个，其中跨级别 ${multi} 个\n` +
      `  ${OUT_FILE} (${(Buffer.byteLength(lines.join('\n')) / 1000).toFixed(0)} KB)\n`,
  )
}

fetchSource(process.argv.includes('--force-download'))
  .then(main)
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
