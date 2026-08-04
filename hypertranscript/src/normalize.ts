/**
 * 对齐用的字符归一化。
 *
 * gpt-transcribe 和 whisper-1 转出来的字面从来不会完全一致：标点疏密不同、
 * 同一个词一边写汉字一边写假名、偶尔全角半角混用。直接逐字比较匹配率很低，
 * 所以先把两边折叠成「可比字符流」再求最长公共子序列。
 *
 * 归一化只用于比较，原文一个字符都不改 —— 每个归一化字符都记着自己在原文
 * 里的下标（origIndex），对齐拿到时间后再映射回去。
 */

/** 归一化后的一个字符，以及它在原文中的下标。 */
export type NormChar = {
  /** 折叠后的字符，仅用于比较 */
  ch: string
  /** 在原始文本中的下标 */
  origIndex: number
}

/**
 * 比较时丢弃的字符：空白、各类标点、括号、连接号。
 *
 * 注意长音符 ー（U+30FC）不在此列 —— 它是日语词的组成部分，删掉会让
 * 「コーヒー」和「コヒ」错误地对上。
 */
const DROP_RE =
  /[\s　、。，．,.:;：；!?！？「」『』（）()［］\[\]｛｝{}〈〉《》【】〔〕…‥・～〜~―—–\-_"'“”‘’]/u

const KATAKANA_START = 0x30a1
const KATAKANA_END = 0x30f6
const KANA_OFFSET = 0x60
const FULLWIDTH_START = 0xff01
const FULLWIDTH_END = 0xff5e
const FULLWIDTH_OFFSET = 0xfee0

/**
 * 把单个字符折叠成可比形式，无需保留时返回 null。
 *
 * 片假名折成平假名是关键一步：whisper 常把外来语之外的词也写成片假名，
 * 而 gpt-transcribe 倾向写汉字或平假名，不折叠会丢掉大量本可匹配的锚点。
 */
function foldChar(ch: string): string | null {
  if (DROP_RE.test(ch)) return null

  const code = ch.charCodeAt(0)
  if (code >= KATAKANA_START && code <= KATAKANA_END) {
    return String.fromCharCode(code - KANA_OFFSET)
  }
  if (code >= FULLWIDTH_START && code <= FULLWIDTH_END) {
    return String.fromCharCode(code - FULLWIDTH_OFFSET).toLowerCase()
  }
  return ch.toLowerCase()
}

/** 把文本折叠成带原文下标的字符流。 */
export function normalize(text: string): NormChar[] {
  const out: NormChar[] = []
  for (let i = 0; i < text.length; i++) {
    const ch = foldChar(text[i])
    if (ch !== null) out.push({ ch, origIndex: i })
  }
  return out
}

/**
 * 建「原文下标 → 归一化下标」的反查表，被丢弃的位置为 -1。
 *
 * kuromoji 是在原文上分词的，token 给的是原文字符区间；要拿这个区间的时间，
 * 得先知道区间里哪些字符在归一化流中还活着。
 */
export function buildReverseIndex(normChars: NormChar[], originalLength: number): Int32Array {
  const table = new Int32Array(originalLength).fill(-1)
  normChars.forEach((nc, i) => {
    table[nc.origIndex] = i
  })
  return table
}
