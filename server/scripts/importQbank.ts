/**
 * 把 n1-qbank/markdown 下的 31 套真题解析进 Qbank* 表（JLPT 精练题库）。
 *
 *   npm run import:qbank                       # 全量导入 ../n1-qbank
 *   npm run import:qbank -- --dir ../n1-qbank --only 2020年12月
 *
 * markdown 格式见 n1-qbank/README.md。行号即契约，改格式要同步改这里。
 *
 * 幂等：行 id 是从「卷 + 卷内编号」推出来的稳定值（如 n1-202012-q1 /
 * n1-202012-l1-1），重跑走 upsert，用户的作答记录和收藏不会被冲掉。
 */
import 'dotenv/config'
import { readdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createNodePrismaClient } from '../src/lib/prisma'

const prisma = createNodePrismaClient()

const SECTION_TO_CATEGORY: Record<string, string> = {
  '文字·語彙': 'vocab',
  文法: 'grammar',
  読解: 'reading',
  聴解: 'listening',
}

export type ParsedPassage = {
  id: string
  level: string
  year: number
  month: number
  code: string
  type: string
  content: string
}

export type ParsedQuestion = {
  id: string
  level: string
  year: number
  month: number
  category: string
  mondaiNo: number
  seq: string
  orderNo: number
  stemJp: string
  stemZh: string
  options: string
  answer: number
  explain: string
  audioKey: string
  source: string
  dispute: string
  passageId: string | null
}

function parseArgs() {
  const args = process.argv.slice(2)
  const get = (name: string) => {
    const i = args.indexOf(`--${name}`)
    return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined
  }
  return {
    dir: get('dir') ?? '../n1-qbank',
    only: get('only'),
    dryRun: args.includes('--dry-run'),
  }
}

/** n1-202012 —— 一卷的稳定前缀，行 id 都由它派生。 */
function paperKey(level: string, year: number, month: number): string {
  return `${level.toLowerCase()}-${year}${String(month).padStart(2, '0')}`
}

/** Q37 → q37；聴解1-1 → l1-1。id 只用 ASCII，方便进 URL 和日志。 */
function seqSlug(seq: string): string {
  const listening = seq.match(/^聴解(\d+)-(\d+)$/)
  if (listening) return `l${listening[1]}-${listening[2]}`
  return seq.toLowerCase()
}

/** audio/2020.12/聴解1-1.mp3 → audio/2020.12/1-1.mp3（R2 对象名保持纯 ASCII）。 */
function audioKeyFor(rawPath: string): string {
  return rawPath.replace(/聴解(\d+)-(\d+)\.mp3$/, '$1-$2.mp3')
}

/** 听力排在笔试之后：1000 + 小节*100 + 题号。 */
function listeningOrder(section: number, no: number): number {
  return 1000 + section * 100 + no
}

export function parsePaper(
  md: string,
  meta: { level: string; year: number; month: number },
): { passages: ParsedPassage[]; questions: ParsedQuestion[]; warnings: string[] } {
  const { level, year, month } = meta
  const prefix = paperKey(level, year, month)
  const lines = md.split(/\r?\n/)
  const passages: ParsedPassage[] = []
  const questions: ParsedQuestion[] = []
  const warnings: string[] = []
  const isHeading = (l: string) => /^#{1,6}\s/.test(l)

  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    // ### 文章 P8-1（内容理解（短文））
    const passageHead = line.match(/^###\s*文章\s*([^（(]+)[（(](.+)[）)]\s*$/)
    if (passageHead) {
      const code = passageHead[1].trim()
      const buf: string[] = []
      i++
      while (i < lines.length && !isHeading(lines[i])) {
        buf.push(lines[i])
        i++
      }
      passages.push({
        id: `${prefix}-${code.toLowerCase()}`,
        level,
        year,
        month,
        code,
        type: passageHead[2].trim(),
        content: buf.join('\n').trim(),
      })
      continue
    }

    // ## Q1 / ## 聴解1-1
    const questionHead = line.match(/^##\s+(Q\d+|聴解\d+-\d+)\s*$/)
    if (!questionHead) {
      i++
      continue
    }

    const seq = questionHead[1]
    const field: Record<string, string> = {}
    const options: string[] = []
    i++
    while (i < lines.length && !isHeading(lines[i])) {
      const optionLine = lines[i].match(/^\s+(\d+)\.\s?(.*)$/)
      if (optionLine) {
        options[Number(optionLine[1]) - 1] = optionLine[2].trim()
      } else {
        const kv = lines[i].match(/^-\s*([a-z_]+)\s*:\s?(.*)$/)
        if (kv) field[kv[1]] = kv[2] ?? ''
      }
      i++
    }

    const category = SECTION_TO_CATEGORY[field.section ?? '']
    if (!category) {
      warnings.push(`${seq}: 未知 section「${field.section}」，已跳过`)
      continue
    }

    const isListening = category === 'listening'
    const mondaiNo = isListening
      ? Number((field.listening ?? '').replace(/\D/g, ''))
      : Number(field.mondai)
    if (!mondaiNo) {
      warnings.push(`${seq}: 无法确定 mondaiNo，已跳过`)
      continue
    }

    const answer = Number(field.answer)
    if (!(answer >= 1 && answer <= options.length)) {
      warnings.push(`${seq}: answer=${field.answer} 超出选项范围(${options.length})`)
    }

    questions.push({
      id: `${prefix}-${seqSlug(seq)}`,
      level,
      year,
      month,
      category,
      mondaiNo,
      seq,
      orderNo: isListening
        ? listeningOrder(mondaiNo, Number(field.mondai_no ?? 0))
        : Number((seq.match(/\d+/) ?? ['0'])[0]),
      stemJp: field.stem_jp ?? '',
      stemZh: field.stem_zh ?? '',
      options: JSON.stringify(options.map((o) => o ?? '')),
      answer,
      explain: field.explain ?? '',
      audioKey: field.audio ? audioKeyFor(field.audio) : '',
      source: field.source ?? 'nadou',
      dispute: field.dispute ?? '',
      passageId: field.passage ? `${prefix}-${field.passage.toLowerCase()}` : null,
    })
  }

  // 引用了不存在的文章 —— 宁可断开关联也不要插出悬空外键。
  const passageIds = new Set(passages.map((p) => p.id))
  for (const q of questions) {
    if (q.passageId && !passageIds.has(q.passageId)) {
      warnings.push(`${q.seq}: 引用了不存在的文章 ${q.passageId}`)
      q.passageId = null
    }
  }

  return { passages, questions, warnings }
}

function inferMeta(file: string): { level: string; year: number; month: number } | null {
  const m = file.match(/(\d{4})年(\d{1,2})月_(N\d)_/)
  if (!m) return null
  return { level: m[3], year: Number(m[1]), month: Number(m[2]) }
}

async function main() {
  const { dir, only, dryRun } = parseArgs()
  const root = resolve(process.cwd(), dir)
  const mdDir = join(root, 'markdown')
  const files = readdirSync(mdDir)
    .filter((f) => f.endsWith('.md'))
    .filter((f) => !only || f.includes(only))
    .sort()

  if (files.length === 0) {
    console.error(`没找到 markdown：${mdDir}`)
    process.exit(2)
  }

  let totalPassages = 0
  let totalQuestions = 0
  const allWarnings: string[] = []

  for (const file of files) {
    const meta = inferMeta(file)
    if (!meta) {
      allWarnings.push(`${file}: 文件名无法解析出 年/月/等级，已跳过`)
      continue
    }
    const stamp = `${meta.year}.${String(meta.month).padStart(2, '0')}`
    const md = await readFile(join(mdDir, file), 'utf8')
    const { passages, questions, warnings } = parsePaper(md, meta)
    allWarnings.push(...warnings.map((w) => `${stamp} ${w}`))

    if (!dryRun) {
      // 先文章后题目：题目的 passageId 指向文章。
      for (const p of passages) {
        const { id, ...data } = p
        await prisma.qbankPassage.upsert({ where: { id }, create: p, update: data })
      }
      for (const q of questions) {
        const { id, ...data } = q
        await prisma.qbankQuestion.upsert({ where: { id }, create: q, update: data })
      }
    }

    totalPassages += passages.length
    totalQuestions += questions.length
    console.log(`  ${stamp}  文章 ${String(passages.length).padStart(3)} 篇   题目 ${String(questions.length).padStart(4)} 道`)
  }

  console.log(`\n${dryRun ? '[dry-run] ' : ''}合计：${files.length} 套，文章 ${totalPassages} 篇，题目 ${totalQuestions} 道`)
  if (allWarnings.length) {
    console.log(`\n⚠ ${allWarnings.length} 条告警：`)
    for (const w of allWarnings) console.log(`  ${w}`)
  }
  if (!dryRun) {
    const [pc, qc] = await Promise.all([
      prisma.qbankPassage.count(),
      prisma.qbankQuestion.count(),
    ])
    console.log(`\n✅ 库内现有：文章 ${pc} 篇，题目 ${qc} 道`)
  }
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
