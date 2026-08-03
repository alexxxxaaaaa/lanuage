// DictEntry 的 AI 缓存行（source='ai'）→ 查词页 AI 小节的平铺视图。
//
// 镜像文件：server/src/lib/aiDictEntry.ts —— 改这边必须同步改那边。
// example 恒重建成「原句｜译文」多行格式，加词播种进 Word.example 后
// LearnPage 的挖空（pickExamplePair）依赖它。

import type { DictEntry } from '../api/dict'
import type { AiFillWordResult } from '../api/ai'

export const AI_SOURCE = 'ai'

/** 查词页 AI 小节渲染 + 「加入单词库」播种用的统一形状。 */
export type AiDictView = {
  word: string
  language: 'en' | 'jp'
  reading: string
  partOfSpeech: string
  meaning: string
  example: string
  note: string
}

export function languageForDirection(direction: string): 'en' | 'jp' {
  return direction === 'en-zh' ? 'en' : 'jp'
}

export function directionForLanguage(language: 'en' | 'jp'): 'ja-zh' | 'en-zh' {
  return language === 'jp' ? 'ja-zh' : 'en-zh'
}

/** DictEntry ai 行 → 平铺视图（entries 接口带回缓存时走这里）。 */
export function entryToAiView(entry: DictEntry): AiDictView {
  const meaning = entry.senses.flatMap((s) => s.glosses ?? []).join('\n')
  const example = entry.senses
    .flatMap((s) => s.examples ?? [])
    .map((e) => (e.translation ? `${e.text}｜${e.translation}` : e.text))
    .join('\n')
  const note = entry.senses.find((s) => s.note)?.note ?? ''
  return {
    word: entry.word,
    language: languageForDirection(entry.direction),
    reading: entry.reading,
    partOfSpeech: entry.pos,
    meaning,
    example,
    note,
  }
}

/** fill-word 响应 → 平铺视图（刚生成完时走这里）。 */
export function fillResultToAiView(result: AiFillWordResult): AiDictView {
  return {
    word: result.word,
    language: result.language,
    reading: result.reading,
    partOfSpeech: result.partOfSpeech,
    meaning: result.meaning,
    example: result.example,
    note: result.note,
  }
}
