/**
 * 词库索引的排序键。
 *
 * 构建脚本（server/scripts/buildDict.ts）用它给索引文件定序，客户端
 * (client/src/lib/dictIndex.ts) 用同一套规则归一化用户输入后做二分查找 ——
 * 两边必须一致，所以只存这一份。
 */

/** 片假名 → 平假名的码位差。 */
const KATAKANA_SHIFT = 0x60

/** 每行假名对应的母音，用来把长音符 ー 展开成实际元音。 */
const VOWEL_ROWS: [string, string][] = [
  ['あ', 'ぁあかがさざただなはばぱまやゃらわゎゕ'],
  ['い', 'ぃいきぎしじちぢにひびぴみりゐ'],
  ['う', 'ぅうくぐすずっつづぬふぶぷむゆゅる'],
  ['え', 'ぇえけげせぜてでねへべぺめれゑゖ'],
  ['お', 'ぉおこごそぞとどのほぼぽもよょろを'],
]

const VOWEL_OF = new Map<string, string>()
for (const [vowel, kana] of VOWEL_ROWS) {
  for (const ch of kana) VOWEL_OF.set(ch, vowel)
}

/**
 * 平假名的 Unicode 码位顺序本身就是五十音順 —— 清音、濁音、半濁音依次相邻
 * （か U+304B → が U+304C → き U+304D），小书き假名排在对应大书き之前。
 * 所以归一化到平假名之后直接按码位比较即可，不需要额外的排序表。
 */
export function kanaSortKey(reading: string): string {
  let out = ''
  for (const ch of reading) {
    const code = ch.codePointAt(0) ?? 0

    // 片假名统一折成平假名，アニメ 与 あにめ 落在同一位置。
    if (code >= 0x30a1 && code <= 0x30f6) {
      out += String.fromCodePoint(code - KATAKANA_SHIFT)
      continue
    }

    // 长音符按辞書順展开成前一个假名的母音：コーヒー → こおひい。
    // 不展开的话 ー(U+30FC) 会排到 ん 之后，外来语整体错位。
    if (ch === 'ー' || ch === '−' || ch === '-') {
      const prev = out.at(-1)
      const vowel = prev ? VOWEL_OF.get(prev) : undefined
      if (vowel) out += vowel
      continue
    }

    // 只保留平假名；中点、空格、括号等排版符号不参与定序。
    if (code >= 0x3041 && code <= 0x3096) out += ch
  }
  return out
}

/** 带调拼音 → 无调小写拼音。ü 折成 v，好让 lü 排在 lu 之后（辞書順惯例）。 */
export function pinyinSortKey(pinyin: string): string {
  return pinyin
    .toLowerCase()
    .replace(/[ǖǘǚǜü]/g, 'v')
    .normalize('NFD')
    // 去掉声调组合符（U+0300–U+036F），ā á ǎ à 统一成 a。
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z]/g, '')
}

/**
 * 无读音的条目排在列表末尾。用码位最大的字符起头，保证它们整体沉底，
 * 且组内仍按词头有序 —— 输入汉字时走词头索引照样能找到。
 */
export const NO_READING_PREFIX = '￿'

export function sortKeyFor(
  direction: 'ja-zh' | 'zh-ja',
  reading: string,
  word: string,
): string {
  const key = direction === 'ja-zh' ? kanaSortKey(reading) : pinyinSortKey(reading)
  return key || NO_READING_PREFIX + word
}
