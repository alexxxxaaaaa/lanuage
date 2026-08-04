/**
 * 查词方向 —— 查词页唯一的语向真相。
 *
 * 以前是两个下拉推出来的（输入语种 + 中文查成什么），中日共用汉字时两边都
 * 说得通，同一个词头就会在两个方向上打架。这里收成一个显式的四选一：方向定了，
 * 词典看哪一批词条、右侧索引翻哪本词头表、AI 用什么 source/target，全由这张表定。
 */
import type { DictEntryDirection } from '../api/dict'
import type { IndexKind } from './dictIndex'

export type SearchDirection = 'ja-zh' | 'zh-ja' | 'en-zh' | 'zh-en'

/** 下拉框的值：四个方向，外加交给字符 / 词库判定的「自动」。 */
export type DirectionChoice = SearchDirection | 'auto'

type DirectionMeta = {
  /** 用户输入的语言 = AI 接口的 sourceLanguage。 */
  source: 'jp' | 'zh' | 'en'
  /** 结果词的语言 = AI 接口的 targetLanguage，也是加词时的 Word.language。 */
  target: 'jp' | 'en'
  /** 词典区块看哪个方向的 DictEntry。null = 库里不存在这个方向的词条。 */
  entry: DictEntryDirection | null
  /** 右侧索引翻哪本词头表。null = 没有可翻的，整条侧栏不渲染。 */
  index: IndexKind | null
  /** 本地 Wiktextract 词库收了这个方向 —— 决定「本地来源」分块出不出。 */
  hasLocalDict: boolean
}

export const DIRECTIONS: SearchDirection[] = ['ja-zh', 'zh-ja', 'en-zh', 'zh-en']

export const DIRECTION_META: Record<SearchDirection, DirectionMeta> = {
  'ja-zh': {
    source: 'jp',
    target: 'jp',
    entry: 'ja-zh',
    index: 'ja-zh',
    hasLocalDict: true,
  },
  // 中→日 的 AI 结果按日语词头缓存（direction='ja-zh'），拿中文词头查一定落空，
  // 所以这个方向只有本地中日词库的词条 —— 和服务端翻译模式恒重新生成一致。
  'zh-ja': {
    source: 'zh',
    target: 'jp',
    entry: 'zh-ja',
    index: 'zh-ja',
    hasLocalDict: true,
  },
  // 英语只有 AI 生成的行（direction='en-zh'），本地词库没有这个方向。
  'en-zh': {
    source: 'en',
    target: 'en',
    entry: 'en-zh',
    index: 'en',
    hasLocalDict: false,
  },
  // 中→英 同理按英语词头缓存，中文词头查不到；也没有中英词头表可翻。
  'zh-en': { source: 'zh', target: 'en', entry: null, index: null, hasLocalDict: false },
}

/** i18n key。下拉选项和别处标注方向共用同一套文案。 */
export const DIRECTION_LABEL: Record<SearchDirection, string> = {
  'ja-zh': 'wordSearch.dirJaZh',
  'zh-ja': 'wordSearch.dirZhJa',
  'en-zh': 'wordSearch.dirEnZh',
  'zh-en': 'wordSearch.dirZhEn',
}

const HAS_KANA = /[぀-ヿㇰ-ㇿ]/
const HAS_HAN = /[一-龯]/

/**
 * 只按字符判方向。假名是日语唯一的铁证，纯汉字中日共用 —— 判不出来就返回 null，
 * 交给 resolveByDict 用词库兜底，不在这里猜。
 *
 * 中文输入默认查成日语（中→日），要中→英 得在下拉里明说：这是个日语学习应用，
 * 而「英语」这条路上拉丁字母输入本身已经无歧义。
 */
export function detectDirection(text: string): SearchDirection | null {
  if (!text) return null
  if (HAS_KANA.test(text)) return 'ja-zh'
  if (HAS_HAN.test(text)) return null
  return 'en-zh'
}

/**
 * 纯汉字输入的方向判定：日语词库收了这个词头就当日语词看，否则当中文词翻成日语。
 * 吃的是这次查询已经拿到的词典结果，不额外发请求。
 */
export function resolveByDict(
  word: string,
  entries: readonly { word: string; direction: string }[],
): SearchDirection {
  return entries.some((entry) => entry.direction === 'ja-zh' && entry.word === word)
    ? 'ja-zh'
    : 'zh-ja'
}
