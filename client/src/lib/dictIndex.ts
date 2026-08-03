/**
 * 右侧索引栏的数据源。
 *
 * 两个来源合成一份词头一览：
 *   - 本地词库：随前端发布的静态文件 client/public/dict/<direction>.idx，每行三列
 *     `sortKey \t 词头 \t 读音`，由 server/scripts/buildDict.ts 按五十音順 /
 *     拼音序排好，客户端只做定位，不排序、不请求接口；
 *   - 用户自己的单词库：AI 查词添加的词，走接口拿全量词头（见 api/words.ts）。
 *
 * 两边都收录的词只占一行，标成 both，展示时两个标签一起挂。
 */
import { kanaSortKey, pinyinSortKey, sortKeyFor } from '../../../shared/dictSort'

export type DictDirection = 'ja-zh' | 'zh-ja'

/** 索引的三种形态。日语之外没有本地词库，索引里只会有 AI 添加的词。 */
export type IndexKind = DictDirection | 'en'

/** 这一行的词从哪来。both = 本地词库和我的单词库都有。 */
export type IndexSource = 'local' | 'ai' | 'both'

/** 排好序的一条词头，还没落到具体某一行。 */
export type IndexEntry = {
  sortKey: string
  word: string
  reading: string
}

export type IndexRow = IndexEntry & {
  /** 行号，同时是虚拟列表里的定位坐标。 */
  line: number
  source: IndexSource
}

/** 合并进来的用户词。 */
export type UserWord = {
  word: string
  reading: string
}

/** 有假名 / 拉丁字母说明用户在按读音查，纯汉字则按词头查。 */
const HAS_KANA = /[぀-ヿ]/
const HAS_LATIN = /[a-zA-Z]/

/**
 * 用户词的排序键，必须和本地索引文件用的是同一套规则，两边才能归并到一起。
 * 英语没有本地词库可对齐，按小写词头排即可。
 */
const SORT_KEY: Record<IndexKind, (word: UserWord) => string> = {
  // sortKeyFor 与构建脚本同源：无读音的词条沉底而不是浮在最前。
  'ja-zh': (w) => sortKeyFor('ja-zh', w.reading || w.word, w.word),
  'zh-ja': (w) => sortKeyFor('zh-ja', w.reading, w.word),
  en: (w) => w.word.toLowerCase(),
}

/** lower_bound：第一个使 valueAt(i) >= key 成立的下标。 */
function lowerBound(size: number, key: string, valueAt: (i: number) => string): number {
  let lo = 0
  let hi = size
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (valueAt(mid) < key) lo = mid + 1
    else hi = mid
  }
  return lo
}

export class DictIndex {
  readonly rows: IndexRow[]
  readonly kind: IndexKind

  private constructor(rows: IndexRow[], kind: IndexKind) {
    this.rows = rows
    this.kind = kind
  }

  get size() {
    return this.rows.length
  }

  /** 解析静态索引文件。结果按 sortKey 有序，可以直接参与归并。 */
  static async loadLocal(direction: DictDirection, signal?: AbortSignal) {
    const res = await fetch(`/dict/${direction}.idx`, { signal })
    if (!res.ok) throw new Error(`词库索引加载失败：${res.status}`)
    const text = await res.text()

    const entries: IndexEntry[] = []
    // 手写切分而不是 text.split('\n').map(...)：后者会先落一个十万级的中间数组。
    for (let start = 0; start < text.length; ) {
      let end = text.indexOf('\n', start)
      if (end === -1) end = text.length
      const t1 = text.indexOf('\t', start)
      const t2 = t1 === -1 ? -1 : text.indexOf('\t', t1 + 1)
      if (t1 !== -1 && t2 !== -1 && t2 < end) {
        entries.push({
          sortKey: text.slice(start, t1),
          word: text.slice(t1 + 1, t2),
          reading: text.slice(t2 + 1, end),
        })
      }
      start = end + 1
    }
    return entries
  }

  /**
   * 本地词头 + 用户词合成一份索引。
   *
   * 两边各自有序，所以是一次线性归并 —— 用户词只有几百上千条，单独排一次再并进
   * 十万条里，比把两边拼起来整体重排便宜一个量级。同名词只留本地那一行，
   * 标成 both：索引是「词头一览」，同一个词头出现两次没有意义。
   */
  static merge(
    kind: IndexKind,
    local: readonly IndexEntry[],
    userWords: readonly UserWord[],
  ): DictIndex {
    const mine = new Map<string, UserWord>()
    for (const word of userWords) {
      if (!mine.has(word.word)) mine.set(word.word, word)
    }

    const localWords = new Set<string>()
    for (const entry of local) localWords.add(entry.word)

    const toSortKey = SORT_KEY[kind]
    const extras: IndexEntry[] = []
    for (const [word, item] of mine) {
      if (localWords.has(word)) continue
      extras.push({ sortKey: toSortKey(item), word, reading: item.reading })
    }
    extras.sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0))

    const rows: IndexRow[] = []
    let i = 0
    let j = 0
    while (i < local.length || j < extras.length) {
      const fromLocal =
        j >= extras.length || (i < local.length && local[i].sortKey <= extras[j].sortKey)
      const entry = fromLocal ? local[i++] : extras[j++]
      rows.push({
        line: rows.length,
        sortKey: entry.sortKey,
        word: entry.word,
        reading: entry.reading,
        source: fromLocal ? (mine.has(entry.word) ? 'both' : 'local') : 'ai',
      })
    }
    return new DictIndex(rows, kind)
  }

  /**
   * 按词头排好的行号视图，供输入汉字时定位用。
   *
   * 懒构建：只有真按词头查过一次才排（约 100–200 ms），之后一直复用。
   * 不在构建期预生成是因为那要多发一个和索引等长的文件，
   * 客户端排一次比多下几百 KB 划算。
   */
  private wordOrder?: Int32Array

  private ensureWordOrder(): Int32Array {
    if (!this.wordOrder) {
      const order = this.rows.map((row) => row.line)
      order.sort((a, b) => {
        const wa = this.rows[a].word
        const wb = this.rows[b].word
        return wa < wb ? -1 : wa > wb ? 1 : a - b
      })
      this.wordOrder = Int32Array.from(order)
    }
    return this.wordOrder
  }

  /**
   * 输入按读音查时的归一化结果，空串表示这串输入不是读音、该按词头查。
   * 归一化用的是 shared/dictSort ——「按读音排序」和「按读音定位」必须是同一套
   * 规则，所以那份文件同时被构建脚本和这里引用。
   */
  private readingKey(query: string): string {
    if (this.kind === 'en') return query.toLowerCase()
    if (this.kind === 'ja-zh') return HAS_KANA.test(query) ? kanaSortKey(query) : ''
    return HAS_LATIN.test(query) ? pinyinSortKey(query) : ''
  }

  /** 定位到最匹配输入的行号，输入为空则回到列表开头。 */
  locate(query: string): number {
    const q = query.trim()
    if (!q || this.size === 0) return 0

    // 词头完全一致优先 —— 点击索引行回填词头、或输入本身就是完整词头
    // （如「食べる」）时，按读音解释混在词头里的假名会定位到别的行：
    // kanaSortKey 丢掉汉字只剩「べる」，而该行的 sortKey 是「たべる」。
    // 词条少时高亮会明显跳错行。
    const order = this.ensureWordOrder()
    const wordAt = lowerBound(this.size, q, (i) => this.rows[order[i]].word)
    if (wordAt < this.size && this.rows[order[wordAt]].word === q) {
      return order[wordAt]
    }

    const key = this.readingKey(q)
    if (key) {
      const at = lowerBound(this.size, key, (i) => this.rows[i].sortKey)
      return Math.min(at, this.size - 1)
    }

    return order[Math.min(wordAt, this.size - 1)]
  }

  /**
   * 预热按词头排序的那份顺序。
   *
   * 11 万条排一次约几百毫秒。等用户敲下第一个汉字再排，这几百毫秒正好砸在
   * 输入响应上；索引装好后先在空闲时段排掉，用的时候就是现成的。
   */
  warmUp() {
    this.ensureWordOrder()
  }
}
