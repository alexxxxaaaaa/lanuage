/**
 * 右侧索引栏的数据源。
 *
 * 索引是随前端发布的静态文件 client/public/dict/<direction>.idx，每行三列：
 *   sortKey \t 词头 \t 读音
 * 由 server/scripts/buildDict.ts 按五十音順 / 拼音序排好，客户端只做定位，
 * 不排序、不请求接口 —— 所以每敲一个字都能零延迟滚到位置。
 */
import { kanaSortKey, pinyinSortKey } from '../../../shared/dictSort'

export type DictDirection = 'ja-zh' | 'zh-ja'

export type IndexRow = {
  /** 行号，同时是虚拟列表里的定位坐标。 */
  line: number
  sortKey: string
  word: string
  reading: string
}

/** 有假名 / 拉丁字母说明用户在按读音查，纯汉字则按词头查。 */
const HAS_KANA = /[぀-ヿ]/
const HAS_LATIN = /[a-zA-Z]/

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
  readonly direction: DictDirection

  private constructor(rows: IndexRow[], direction: DictDirection) {
    this.rows = rows
    this.direction = direction
  }

  get size() {
    return this.rows.length
  }

  static async load(direction: DictDirection, signal?: AbortSignal) {
    const res = await fetch(`/dict/${direction}.idx`, { signal })
    if (!res.ok) throw new Error(`词库索引加载失败：${res.status}`)
    const text = await res.text()

    const rows: IndexRow[] = []
    let line = 0
    // 手写切分而不是 text.split('\n').map(...)：后者会先落一个十万级的中间数组。
    for (let start = 0; start < text.length; ) {
      let end = text.indexOf('\n', start)
      if (end === -1) end = text.length
      const t1 = text.indexOf('\t', start)
      const t2 = t1 === -1 ? -1 : text.indexOf('\t', t1 + 1)
      if (t1 !== -1 && t2 !== -1 && t2 < end) {
        rows.push({
          line: line++,
          sortKey: text.slice(start, t1),
          word: text.slice(t1 + 1, t2),
          reading: text.slice(t2 + 1, end),
        })
      }
      start = end + 1
    }
    return new DictIndex(rows, direction)
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
   * 定位到最匹配输入的行号，输入为空则回到列表开头。
   *
   * 输入的归一化用的是 shared/dictSort ——「按读音排序」和「按读音定位」
   * 必须是同一套规则，所以那份文件同时被构建脚本和这里引用。
   */
  locate(query: string): number {
    const q = query.trim()
    if (!q || this.size === 0) return 0

    const byReading = this.direction === 'ja-zh' ? HAS_KANA.test(q) : HAS_LATIN.test(q)
    if (byReading) {
      const key = this.direction === 'ja-zh' ? kanaSortKey(q) : pinyinSortKey(q)
      if (key) {
        const at = lowerBound(this.size, key, (i) => this.rows[i].sortKey)
        return Math.min(at, this.size - 1)
      }
    }

    const order = this.ensureWordOrder()
    const at = lowerBound(this.size, q, (i) => this.rows[order[i]].word)
    return order[Math.min(at, this.size - 1)]
  }

  /**
   * 预热按词头排序的那份顺序。
   *
   * 11 万条排一次约几百毫秒。等用户敲下第一个汉字再排，这几百毫秒正好砸在
   * 输入响应上；索引加载完先在空闲时段排掉，用的时候就是现成的。
   */
  warmUp() {
    this.ensureWordOrder()
  }

  /** 词头精确命中就返回该行 —— 回车时用它判断本地词库有没有收录。 */
  findExact(word: string): IndexRow | null {
    if (this.size === 0) return null
    const order = this.ensureWordOrder()
    const at = lowerBound(this.size, word, (i) => this.rows[order[i]].word)
    if (at >= this.size) return null
    const row = this.rows[order[at]]
    return row.word === word ? row : null
  }
}
