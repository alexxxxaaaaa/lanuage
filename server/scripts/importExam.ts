/**
 * 把「真题题库 markdown」解析并导入本地数据库（ExamPaper / ExamPassage / ExamQuestion）。
 *
 * 用法（需先在 server/.env 里配置 DATABASE_URL，例如 file:./dev.db）：
 *   npm run import:exam -- --file ../N1/整理/2020年12月_N1_题库.md --year 2020 --month 12
 *   # year/month 省略时，会尝试从文件名（如「2020年12月」）解析
 *
 * 幂等：按 (level, year, month) 找/建试卷，重导时先清空该卷的旧题目与文章再写入。
 */
import 'dotenv/config'
import { readFile } from 'node:fs/promises'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

type Passage = { code: string; type: string; content: string }
type Question = {
  seq: string
  orderNo: number
  section: string
  mondai: string
  type: string
  stemJp: string
  stemZh: string
  options: string[]
  answer: number
  explain: string
  passageCode: string
}

function parseArgs() {
  const args = process.argv.slice(2)
  const get = (name: string) => {
    const i = args.indexOf(`--${name}`)
    return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined
  }
  return {
    file: get('file') ?? '../N1/整理/2020年12月_N1_题库.md',
    year: get('year') ? Number(get('year')) : undefined,
    month: get('month') ? Number(get('month')) : undefined,
    level: get('level') ?? 'N1',
  }
}

/** 从文件名解析「YYYY年MM月」 */
function inferYearMonth(file: string): { year?: number; month?: number } {
  const m = file.match(/(\d{4})\s*年\s*(\d{1,2})\s*月/)
  if (m) return { year: Number(m[1]), month: Number(m[2]) }
  return {}
}

/** 计算听力题的排序值：写作题用 1..999，听力排在 1000 之后 */
function listeningOrder(listening: string, mondaiNo: string): number {
  const sec = Number((listening.match(/(\d+)/) ?? [])[1] ?? 0) // 聴解1 -> 1
  // mondaiNo 可能是 "1" 或 "2-1"
  const parts = mondaiNo.split('-').map((x) => Number(x) || 0)
  const a = parts[0] ?? 0
  const b = parts[1] ?? 0
  return 1000 + sec * 100 + a * 10 + b
}

function parseMarkdown(md: string) {
  const lines = md.split(/\r?\n/)
  const passages: Passage[] = []
  const questions: Question[] = []

  let i = 0
  const isHeading = (l: string) => /^#{1,6}\s/.test(l)

  while (i < lines.length) {
    const line = lines[i]

    // 文章块： ### 文章 P10（内容理解(長文)）
    const pass = line.match(/^###\s*文章\s*([^（(]+)[（(](.+?)[）)]\s*$/)
    if (pass) {
      const code = pass[1].trim()
      const type = pass[2].trim()
      i++
      const buf: string[] = []
      while (i < lines.length && !isHeading(lines[i])) {
        buf.push(lines[i])
        i++
      }
      passages.push({ code, type, content: buf.join('\n').trim() })
      continue
    }

    // 题目块： ## Q1  或  ## 聴解1-1
    const q = line.match(/^##\s+(Q\d+|聴解\S+)\s*$/)
    if (q) {
      const seq = q[1].trim()
      i++
      const rec: Record<string, string> = {}
      const options: string[] = []
      while (i < lines.length && !isHeading(lines[i])) {
        const l = lines[i]
        const opt = l.match(/^\s+(\d+)\.\s?(.*)$/) // 选项行： "  1. xxx"
        if (opt) {
          options[Number(opt[1]) - 1] = opt[2].trim()
          i++
          continue
        }
        const field = l.match(/^-\s*([A-Za-z_]+)\s*:\s?(.*)$/)
        if (field) {
          rec[field[1]] = field[2] ?? ''
        }
        i++
      }

      const section = rec.section ?? ''
      const isListening = section.includes('聴解') || !!rec.listening
      const mondai = rec.mondai ?? (rec.listening ? `${rec.listening} ${rec.mondai_no ?? ''}`.trim() : '')
      const orderNo = isListening
        ? listeningOrder(rec.listening ?? '聴解', rec.mondai_no ?? '0')
        : Number((seq.match(/\d+/) ?? ['0'])[0])

      questions.push({
        seq,
        orderNo,
        section,
        mondai,
        type: rec.type ?? '',
        stemJp: rec.stem_jp ?? '',
        stemZh: rec.stem_zh ?? '',
        options: options.filter((x) => x !== undefined),
        answer: Number(rec.answer ?? 0),
        explain: rec.explain ?? '',
        passageCode: rec.passage ?? '',
      })
      continue
    }

    i++
  }

  return { passages, questions }
}

async function main() {
  const { file, level } = parseArgs()
  let { year, month } = parseArgs()
  if (!year || !month) {
    const inf = inferYearMonth(file)
    year = year ?? inf.year
    month = month ?? inf.month
  }
  if (!year || !month) {
    console.error('无法确定 year/month，请用 --year --month 指定')
    process.exit(2)
  }

  const md = await readFile(file, 'utf8')
  const { passages, questions } = parseMarkdown(md)
  console.log(`解析完成：${file}`)
  console.log(`  文章 ${passages.length} 篇，题目 ${questions.length} 道`)

  // 基本校验
  const bad = questions.filter((q) => !q.answer || q.answer < 1 || q.answer > 4)
  if (bad.length) {
    console.warn(`  ⚠ ${bad.length} 道题 answer 异常：${bad.map((b) => b.seq).join(', ')}`)
  }

  const title = `${year}年${String(month).padStart(2, '0')}月 日语${level}`

  // upsert 试卷
  const paper = await prisma.examPaper.upsert({
    where: { level_year_month: { level, year, month } },
    update: { title },
    create: { level, year, month, title },
  })

  // 重导：清空旧数据
  await prisma.examQuestion.deleteMany({ where: { paperId: paper.id } })
  await prisma.examPassage.deleteMany({ where: { paperId: paper.id } })

  if (passages.length) {
    await prisma.examPassage.createMany({
      data: passages.map((p) => ({ paperId: paper.id, code: p.code, type: p.type, content: p.content })),
    })
  }
  if (questions.length) {
    await prisma.examQuestion.createMany({
      data: questions.map((q) => ({
        paperId: paper.id,
        seq: q.seq,
        orderNo: q.orderNo,
        section: q.section,
        mondai: q.mondai,
        type: q.type,
        stemJp: q.stemJp,
        stemZh: q.stemZh,
        options: JSON.stringify(q.options),
        answer: q.answer,
        explain: q.explain,
        passageCode: q.passageCode,
      })),
    })
  }

  const [pc, qc] = await Promise.all([
    prisma.examPassage.count({ where: { paperId: paper.id } }),
    prisma.examQuestion.count({ where: { paperId: paper.id } }),
  ])
  console.log(`✅ 导入完成：试卷「${title}」(id=${paper.id})`)
  console.log(`   文章 ${pc} 篇，题目 ${qc} 道`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
