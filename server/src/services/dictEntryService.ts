import { prisma } from '../lib/prisma'
import { AppError } from '../errors/AppError'

/**
 * 本地词库（DictEntry 表）的查询。
 *
 * 和 dictionaryService 分开：那边是查外部 API（jisho / dictionaryapi.dev），
 * 给搜索框的输入建议用；这边是我们自己的 Wiktextract 词库，供结果区
 * 「Wiktextract」来源块和回车精确匹配用。
 *
 * 右侧索引栏不走这里 —— 它读随前端发布的静态 .idx 文件，在客户端二分定位。
 */

export type DictSense = {
  glosses: string[]
  examples?: { text: string; translation?: string }[]
  /** 中文维基的压缩段落可能在同一词条内切换词性。 */
  pos?: string
}

export type DictEntryDto = {
  id: number
  word: string
  reading: string
  romaji: string
  pos: string
  senses: DictSense[]
  direction: DictDirection
  source: string
}

export type DictDirection = 'ja-zh' | 'zh-ja'

const DIRECTIONS: DictDirection[] = ['ja-zh', 'zh-ja']

function isDirection(value: string): value is DictDirection {
  return (DIRECTIONS as string[]).includes(value)
}

/** senses 在库里是 JSON 字符串。坏行不该让整次查询失败，退化成空义项。 */
function parseSenses(raw: string): DictSense[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/**
 * 词头精确匹配。不传 direction 就两个方向都查 —— 回车搜索时用户没有选方向，
 * 「保護」这种中日共有的词两边都该出。
 */
export async function lookupLocalDict(
  term: string,
  direction?: string,
): Promise<DictEntryDto[]> {
  const word = term.trim()
  if (!word) throw new AppError('term is required', 400)

  if (direction !== undefined && !isDirection(direction)) {
    throw new AppError('direction must be ja-zh or zh-ja', 400)
  }

  const rows = await prisma.dictEntry.findMany({
    where: { word, ...(direction ? { direction } : {}) },
    // 同一个词头下多条义项，按方向聚在一起，方向内按词性稳定排序。
    orderBy: [{ direction: 'asc' }, { pos: 'asc' }, { id: 'asc' }],
    // 词头相同的义项条数有限（最多几十条），但仍设上限防御异常数据。
    take: 50,
  })

  return rows.map((row) => ({
    id: row.id,
    word: row.word,
    reading: row.reading,
    romaji: row.romaji,
    pos: row.pos,
    senses: parseSenses(row.senses),
    direction: row.direction as DictDirection,
    source: row.source,
  }))
}
