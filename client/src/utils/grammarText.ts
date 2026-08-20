/**
 * 蓝宝书条目的文本处理。
 *
 * 书里的日文带两样标记，两样都是 Anki 卡片的原始写法：
 *
 *   注音   `恩[おん] 人[じん]` —— 汉字紧跟方括号里的读音，词与词之间用空格断开。
 *          空格只是分隔符，渲染时要吃掉，否则句子里会多出一串空洞。
 *   高亮   `<b>あっての</b>` —— 圈出这一句里正在讲的那个句型。
 *
 * 渲染这两样标记的是 components/JpText.tsx，这里只放不带 JSX 的部分。
 * 手工建的条目两样标记都没有，走同一批函数原样输出。
 */
import type { GrammarExample } from '../types'

// 可选的前导空格 + 一段非空白非括号的字 + [读音]。非贪婪，免得
// 「去[きょ] 年[ねん]」被当成一个跨到第二个方括号的整体。
// 卡片里半角和全角空格都当过分隔符，所以两个都要认。全角那个写成 \u3000 而
// 不是字面量 —— 它在源码里和半角长得一模一样，摆在字符类里没人看得出来。
export const RUBY_RE = /[ \u3000]?([^\s[\]]+?)\[([^\]]+?)\]/g
export const BOLD_SPLIT_RE = /(<\/?b>)/gi

/** 去掉注音和高亮标记，留纯文本 —— 搜索、朗读、丢给 AI 时用这一份。 */
export function stripAnnotations(text: string): string {
  return text
    .replace(RUBY_RE, (_m, base: string) => base)
    .replace(BOLD_SPLIT_RE, '')
}

/** examples / images 在接口上可能是 JSON 字符串，也可能已经是数组。 */
function parseJsonField<T>(raw: unknown, isValid: (v: unknown) => boolean): T[] {
  if (Array.isArray(raw)) return raw.filter(isValid) as T[]
  if (typeof raw !== 'string' || !raw.trim()) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed.filter(isValid) as T[]) : []
  } catch {
    return []
  }
}

export function parseExamples(raw: unknown): GrammarExample[] {
  return parseJsonField<GrammarExample>(
    raw,
    (v) =>
      typeof v === 'object' && v !== null && typeof (v as GrammarExample).jp === 'string',
  )
}

export function parseImages(raw: unknown): string[] {
  return parseJsonField<string>(raw, (v) => typeof v === 'string' && v.length > 0)
}

/**
 * 例句的统一入口：有结构化的就用结构化的，没有就把 example / exampleZh 两段
 * 纯文本按行号配对 —— 手工建的条目一直是这么存的，详情页也一直这么渲染。
 */
export function resolveExamples(grammar: {
  examples?: unknown
  example?: string
  exampleZh?: string
}): GrammarExample[] {
  const structured = parseExamples(grammar.examples)
  if (structured.length > 0) return structured

  const jp = (grammar.example ?? '').split('\n').filter((s) => s.trim())
  const zh = (grammar.exampleZh ?? '').split('\n').filter((s) => s.trim())
  return jp.map((line, i) => ({ jp: line, zh: zh[i] ?? '', tag: '', audio: '' }))
}
