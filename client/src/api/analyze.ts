import { apiClient } from './client'

/**
 * 文解析接口。服务端实现见 server/src/services/textAnalyzeService.ts —— 那边
 * 的类型是这里的真相，改一边要同步改另一边。
 */

export type AnalyzeToken = {
  /** 句中原样出现的词形。同一句所有 word 顺序拼接 === 句子原文。 */
  word: string
  /** 学校文法的日文词性标签（名詞/動詞/…），标点是「記号」，判不出为空串。 */
  pos: string
  /** 平假名读音。词里没有汉字时是空串。 */
  kana: string
  /** 辞書形。与 word 相同时是空串 —— 一律用 `tokenBase()` 取。 */
  base: string
}

export type AnalyzeSentence = {
  text: string
  /** 整句中文翻译。这一句没解析成功时是空串。 */
  zh: string
  tokens: AnalyzeToken[]
}

export type AnalyzeTextResult = {
  sentences: AnalyzeSentence[]
  /** 解析失败、只能原样显示的句子数。 */
  failedCount: number
}

export type AnalyzeWordResult = {
  /** 句中形，原样回显。 */
  word: string
  kana: string
  /** 辞書形。下面的查词区块和 JLPT 级别都按它走。 */
  base: string
  /** 中文词性。 */
  pos: string
  /** 该词在这句话里的意思。 */
  meaning: string
  /** 详细语法解释，【】高亮术语。 */
  explanation: string
}

export async function analyzeText(text: string) {
  const response = await apiClient.post<AnalyzeTextResult>('/api/ai/analyze-text', {
    text,
  })
  return response.data
}

/** 词 + 它所在的整句 → 语境化的读音 / 辞書形 / 语法详解。 */
export async function analyzeWord(payload: {
  word: string
  sentence: string
  pos?: string
  kana?: string
  base?: string
}) {
  const response = await apiClient.post<AnalyzeWordResult>('/api/ai/analyze-word', payload)
  return response.data
}
