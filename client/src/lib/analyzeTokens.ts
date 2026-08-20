/**
 * 解析结果里一个词怎么归类、画什么颜色的下划线。
 *
 * 两套着色互斥，由解析结果框上的「模式」下拉切换：
 *
 *  - `pos`  按学校文法十大品詞分组着色，看的是句子结构
 *  - `jlpt` 按 JLPT 级别着色（以**辞書形**查 lib/jlptVocab 那张表），看的是
 *           这句话里哪些词超出了自己的级别；表里没有的词一律灰色
 *
 * 颜色写成固定的 Tailwind 类名而不是主题变量：这十一种色是一套图例，彼此区分
 * 才是它们的全部意义，跟着品牌色走反而会撞在一起。类名是字面量，Tailwind 的
 * 扫描器认得出来。
 */
import type { AnalyzeToken } from '../api/analyze'
import { JLPT_LEVELS, type JlptLevel } from './jlptVocab'

export const POS_GROUPS = [
  'n',
  'v',
  'adj',
  'adjv',
  'adv',
  'adn',
  'conj',
  'int',
  'p',
  'aux',
] as const

/** 十大品詞 + 'o'（記号以外的判不出来的词）。 */
export type PosGroup = (typeof POS_GROUPS)[number] | 'o'

/** 服务端约束了 pos 取值，这里仍按包含匹配兜底 —— 模型偶尔会给「動詞-自立」。 */
export function getPosGroup(pos: string): PosGroup {
  if (!pos) return 'o'
  if (pos.includes('助動詞')) return 'aux'
  if (pos.includes('助詞')) return 'p'
  if (pos.includes('感動詞')) return 'int'
  if (pos.includes('接続詞')) return 'conj'
  if (pos.includes('連体詞')) return 'adn'
  if (pos.includes('副詞')) return 'adv'
  // 形容動詞 要排在 形容詞 前面，否则被后者的包含匹配抢走。
  if (pos.includes('形容動詞') || pos.includes('形状詞')) return 'adjv'
  if (pos.includes('形容詞')) return 'adj'
  if (pos.includes('動詞')) return 'v'
  if (pos.includes('名詞') || pos.includes('代名詞')) return 'n'
  return 'o'
}

export const POS_COLOR: Record<PosGroup, string> = {
  n: 'bg-sky-500',
  v: 'bg-emerald-500',
  adj: 'bg-amber-500',
  adjv: 'bg-orange-600',
  adv: 'bg-violet-500',
  adn: 'bg-fuchsia-500',
  conj: 'bg-teal-500',
  int: 'bg-rose-500',
  p: 'bg-indigo-400',
  aux: 'bg-lime-500',
  o: 'bg-foreground/20',
}

/** JLPT 着色。表里查不到的词（含专有名词、口语、超纲词）走 'none'。 */
export const JLPT_COLOR: Record<JlptLevel | 'none', string> = {
  N1: 'bg-red-500',
  N2: 'bg-orange-500',
  N3: 'bg-amber-400',
  N4: 'bg-emerald-500',
  N5: 'bg-sky-500',
  none: 'bg-foreground/20',
}

/** 图例的顺序：级别从难到易，最后挂「其他」。 */
export const JLPT_LEGEND: readonly (JlptLevel | 'none')[] = [...JLPT_LEVELS, 'none']

export type ColorMode = 'pos' | 'jlpt'

const PUNCTUATION_ONLY =
  /^[\s。、，,.!?？！:：;；「」『』（）()[\]【】〈〉《》…・･〜～ー―—-]+$/

/**
 * 标点、空白、换行 —— 不着色、不可点。它们不是词，点开只会白烧一次 token。
 * 词性判定和字符判定取并集：模型偶尔把「。」标成名詞，也偶尔把「ー」标成記号。
 */
export function isPunctuation(token: AnalyzeToken): boolean {
  return token.pos.includes('記号') || PUNCTUATION_ONLY.test(token.word)
}

/** 辞書形。服务端「与词形相同就留空」，消费方统一从这里取。 */
export function tokenBase(token: AnalyzeToken): string {
  return token.base || token.word
}

const KANJI = /[㐀-䶿一-鿿]/

export function hasKanji(text: string): boolean {
  return KANJI.test(text)
}
