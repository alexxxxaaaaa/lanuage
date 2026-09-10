/**
 * 从播客标题里认出这是哪一场 JLPT 真题。
 *
 * 标题的来源乱七八糟——YouTube 元数据（"#1 2010/7JLPT N1 Japanese Listening
 * Test with answers."）、mp3 导入时手填的（"2011.7 N1 听力"）、还有 YouTube
 * 被墙时回落成的 videoId。所以这里只做「能认就认」：认出来的进套，认不出的
 * 留 0，用户在前端手动归类。
 */

export type ExamTag = {
  /** N1..N5；认不出是空串 */
  level: string
  /** 四位年份；认不出是 0 */
  year: number
  /** JLPT 一年两场，7 或 12；认不出是 0 */
  month: number
}

export const EMPTY_EXAM_TAG: ExamTag = { level: '', year: 0, month: 0 }

/** 真题最早从 1984 年开始，上限给到「明年」，防止把 2000 这种句子里的数字
 *  或者 1080p 之类的画质标记当成年份。 */
const MIN_YEAR = 1984

/** 年月连在一起的几种写法。顺序有讲究：先试带分隔符的完整写法，
 *  再退回到「年份 + 附近的月份」。 */
const YEAR_MONTH_PATTERNS: RegExp[] = [
  // 2010/7 · 2010-12 · 2010.7 · 2010_12
  /(\d{4})\s*[/\-._]\s*(\d{1,2})(?!\d)/,
  // 2023年12月 · 2023 年 12 月
  /(\d{4})\s*年\s*(\d{1,2})\s*月/,
  // 201007 / 202312 —— 六位连写
  /(?<!\d)(\d{4})(0[7-9]|1[0-2]|0[1-6])(?!\d)/,
]

const LEVEL_RE = /\bN\s*([1-5])\b/i

function maxYear() {
  return new Date().getFullYear() + 1
}

function pickMonth(raw: number): number {
  // JLPT 只在 7 月和 12 月考。别的月份多半是把无关数字读成了月份，
  // 与其存个错的，不如留空让用户自己填。
  if (raw === 7 || raw === 12) return raw
  return 0
}

export function parseExamTag(title: string): ExamTag {
  if (!title?.trim()) return { ...EMPTY_EXAM_TAG }
  const text = title.trim()

  let year = 0
  let month = 0
  for (const re of YEAR_MONTH_PATTERNS) {
    const m = re.exec(text)
    if (!m) continue
    const y = Number(m[1])
    if (y < MIN_YEAR || y > maxYear()) continue
    year = y
    month = pickMonth(Number(m[2]))
    break
  }

  // 没匹配到年月组合时，退一步只找个孤立年份（"2011 N1 听力"）。
  if (year === 0) {
    for (const m of text.matchAll(/(?<!\d)(\d{4})(?!\d)/g)) {
      const y = Number(m[1])
      if (y >= MIN_YEAR && y <= maxYear()) {
        year = y
        break
      }
    }
  }

  const levelMatch = LEVEL_RE.exec(text)
  const level = levelMatch ? `N${levelMatch[1]}` : ''

  return { level, year, month }
}

/** 归一化用户手填的归类值，同时挡住明显不合法的输入。 */
export function normalizeExamTag(input: {
  level?: string | null
  year?: number | null
  month?: number | null
}): ExamTag {
  const rawLevel = (input.level ?? '').trim().toUpperCase()
  const level = /^N[1-5]$/.test(rawLevel) ? rawLevel : ''

  const rawYear = Number(input.year ?? 0)
  const year =
    Number.isInteger(rawYear) && rawYear >= MIN_YEAR && rawYear <= maxYear()
      ? rawYear
      : 0

  const rawMonth = Number(input.month ?? 0)
  const month = pickMonth(Number.isInteger(rawMonth) ? rawMonth : 0)

  return { level, year, month }
}
