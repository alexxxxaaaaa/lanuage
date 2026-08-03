// AI 生成的词义 ↔ DictEntry 行的双向映射。
//
// AI 结果是平铺的 {reading, partOfSpeech, meaning, example, note}，DictEntry
// 存 Sense[] JSON。这里的往返必须无损：加词播种到 Word 和 LearnPage 的例句
// 挖空都依赖 example 的「原句｜译文」多行格式（ASCII | 会被归一成全角 ｜）。
//
// 镜像文件：client/src/lib/aiDictEntry.ts —— 改这边必须同步改那边。

import type { DictSense } from '../services/dictEntryService'

export const AI_SOURCE = 'ai'

type AiLanguage = 'en' | 'jp'

export type AiFillFields = {
  word: string
  language: AiLanguage
  reading: string
  partOfSpeech: string
  meaning: string
  example: string
  note: string
}

export function directionForLanguage(language: AiLanguage): 'ja-zh' | 'en-zh' {
  return language === 'jp' ? 'ja-zh' : 'en-zh'
}

export function languageForDirection(direction: string): AiLanguage {
  return direction === 'en-zh' ? 'en' : 'jp'
}

/**
 * 缓存键：en 词头统一小写（DictEntry 精确匹配区分大小写，查询侧配合加了
 * 小写候选，见 dictEntryService.lookupLocalDict）；日语原样。
 */
export function aiCacheWord(word: string, language: AiLanguage): string {
  return language === 'en' ? word.toLowerCase() : word
}

/** 「原句｜译文」一行 → Sense 的 example 对象。按第一个 ｜/| 切分。 */
function parseExampleLine(line: string): { text: string; translation?: string } {
  const idx = line.search(/[｜|]/)
  if (idx === -1) return { text: line }
  const text = line.slice(0, idx).trim()
  const translation = line.slice(idx + 1).trim()
  return translation ? { text, translation } : { text }
}

function splitLines(value: string): string[] {
  return value
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
}

/** AI 结果 → DictEntry.create 的 data。恒生成单 sense。 */
export function aiResultToDictEntryData(result: AiFillFields) {
  const glosses = splitLines(result.meaning)
  const examples = splitLines(result.example).map(parseExampleLine)
  const sense: DictSense = {
    glosses,
    ...(examples.length ? { examples } : {}),
    ...(result.note ? { note: result.note } : {}),
  }
  return {
    word: aiCacheWord(result.word, result.language),
    reading: result.reading,
    romaji: '',
    pos: result.partOfSpeech,
    senses: JSON.stringify([sense]),
    direction: directionForLanguage(result.language),
    source: AI_SOURCE,
    // 运行时引不了 shared/dictSort（server tsconfig rootDir 限制）。sortKey 只
    // 服务静态 .idx 的构建（不读库），DB 行存空串零影响。
    sortKey: '',
  }
}

/** DictEntry ai 行 → 平铺的 AI 结果（读缓存命中时走这里）。 */
export function dictEntryRowToFillResult(row: {
  word: string
  reading: string
  pos: string
  senses: string
  direction: string
}): AiFillFields {
  let senses: DictSense[] = []
  try {
    const parsed = JSON.parse(row.senses)
    if (Array.isArray(parsed)) senses = parsed
  } catch {
    // 坏行退化成空义项，别让缓存读挂掉整个生成链路
  }
  const meaning = senses.flatMap((s) => s.glosses ?? []).join('\n')
  const example = senses
    .flatMap((s) => s.examples ?? [])
    .map((e) => (e.translation ? `${e.text}｜${e.translation}` : e.text))
    .join('\n')
  const note = senses.find((s) => s.note)?.note ?? ''
  return {
    word: row.word,
    language: languageForDirection(row.direction),
    reading: row.reading,
    partOfSpeech: row.pos,
    meaning,
    example,
    note,
  }
}
