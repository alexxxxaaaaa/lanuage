/**
 * 把 whisper-1 的词级时间轴迁移到 gpt-transcribe 的文本上。
 *
 * 思路：两边都折叠成可比字符流 → LCS 求出锚点 → 锚点之间线性插值。
 * 结果是 gpt 文本里每一个归一化字符都拿到一个 [start, end] 区间，
 * 再由 tokenize 那层按形态素边界聚合成词。
 */

import { normalize, type NormChar } from './normalize.ts'

/** whisper verbose_json 里的一个词。 */
export type WhisperWord = {
  word: string
  /** 秒 */
  start: number
  /** 秒 */
  end: number
}

/** 一个字符的时间区间，单位秒。 */
export type CharSpan = {
  start: number
  end: number
}

type TimedChar = CharSpan & { ch: string }

/**
 * LCS 的 DP 矩阵上限。单题音频最长约 8 分钟、2000 字上下，远够用；
 * 真喂进来一条超长音频时退化成分块对齐，块边界会有小误差但不会 OOM。
 */
const MAX_DP_CELLS = 4e7
const FALLBACK_CHUNK_CELLS = 1e7

/**
 * 把 whisper 的词拆成字符级时间轴。
 *
 * whisper 只给到词边界，词内部按字符数均分 —— 日语单词都很短（多数 1~4 字），
 * 均分带来的误差远小于后面 LCS 插值的误差，不值得再引入声学对齐。
 */
export function expandWordsToChars(words: WhisperWord[]): TimedChar[] {
  const out: TimedChar[] = []
  for (const word of words) {
    const chars = normalize(word.word)
    if (chars.length === 0) continue

    const start = word.start
    const span = Math.max(0, word.end - word.start) / chars.length
    chars.forEach((nc, i) => {
      out.push({ ch: nc.ch, start: start + span * i, end: start + span * (i + 1) })
    })
  }
  return out
}

/**
 * 求两个字符序列的最长公共子序列，返回匹配下标对。
 *
 * 用 Int32Array 手动铺平二维 DP，比嵌套数组省一个数量级的内存 ——
 * 2000×2000 时是 16 MB 连续内存而不是 400 万个 JS 数字对象。
 */
function lcsPairs(a: string[], b: string[]): Array<[number, number]> {
  const n = a.length
  const m = b.length
  if (n === 0 || m === 0) return []
  if (n * m > MAX_DP_CELLS) return chunkedLcsPairs(a, b)

  const width = m + 1
  const dp = new Int32Array((n + 1) * width)

  for (let i = n - 1; i >= 0; i--) {
    const row = i * width
    const next = (i + 1) * width
    for (let j = m - 1; j >= 0; j--) {
      dp[row + j] =
        a[i] === b[j]
          ? dp[next + j + 1] + 1
          : Math.max(dp[next + j], dp[row + j + 1])
    }
  }

  const pairs: Array<[number, number]> = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pairs.push([i, j])
      i++
      j++
    } else if (dp[(i + 1) * width + j] >= dp[i * width + j + 1]) {
      i++
    } else {
      j++
    }
  }
  return pairs
}

/**
 * 超长输入的退路：按相同比例把两边切成等份，逐块 LCS 后拼接。
 *
 * 前提是两个模型转的是同一段音频、内容大体同序，所以等比切分落点不会差太远。
 */
function chunkedLcsPairs(a: string[], b: string[]): Array<[number, number]> {
  const chunks = Math.ceil(Math.sqrt((a.length * b.length) / FALLBACK_CHUNK_CELLS))
  const pairs: Array<[number, number]> = []

  for (let k = 0; k < chunks; k++) {
    const aStart = Math.floor((a.length * k) / chunks)
    const aEnd = Math.floor((a.length * (k + 1)) / chunks)
    const bStart = Math.floor((b.length * k) / chunks)
    const bEnd = Math.floor((b.length * (k + 1)) / chunks)

    for (const [i, j] of lcsPairs(a.slice(aStart, aEnd), b.slice(bStart, bEnd))) {
      pairs.push([aStart + i, bStart + j])
    }
  }
  return pairs
}

/** 对齐结果：每个归一化字符的时间，以及一份对齐质量指标。 */
export type AlignResult = {
  /** 与 gptChars 等长，逐字符的时间区间 */
  spans: CharSpan[]
  /** LCS 命中的字符数 ÷ gpt 字符总数，低于 0.6 通常意味着两版转写差异过大 */
  matchRate: number
}

/**
 * 把 whisper 的字符时间轴插值到 gpt 的字符流上。
 *
 * LCS 命中的字符直接取 whisper 的时间当锚点；锚点之间的空隙按字符数均匀铺开。
 * 首尾没有锚点兜底时，用相邻锚点向 0 / duration 外推 —— 这两段通常是开场白和
 * 收尾的「以上で終わります」，插值误差对点词跳转的影响可以忽略。
 */
export function alignTimings(
  gptChars: NormChar[],
  whisperChars: TimedChar[],
  duration: number,
): AlignResult {
  const spans: CharSpan[] = new Array(gptChars.length)
  if (gptChars.length === 0) return { spans: [], matchRate: 0 }

  if (whisperChars.length === 0) {
    // 没有时间轴可用时退化成整段均分，至少保证播放器不会拿到空值。
    const step = duration / gptChars.length
    for (let i = 0; i < gptChars.length; i++) {
      spans[i] = { start: step * i, end: step * (i + 1) }
    }
    return { spans, matchRate: 0 }
  }

  const pairs = lcsPairs(
    gptChars.map((c) => c.ch),
    whisperChars.map((c) => c.ch),
  )

  // 锚点：gpt 字符下标 → whisper 时间
  const anchors: Array<{ index: number; span: CharSpan }> = pairs.map(([i, j]) => ({
    index: i,
    span: { start: whisperChars[j].start, end: whisperChars[j].end },
  }))

  if (anchors.length === 0) {
    const step = duration / gptChars.length
    for (let i = 0; i < gptChars.length; i++) {
      spans[i] = { start: step * i, end: step * (i + 1) }
    }
    return { spans, matchRate: 0 }
  }

  for (const { index, span } of anchors) spans[index] = span

  // 首个锚点之前：从 0 均匀铺到该锚点。
  fillRange(spans, 0, anchors[0].index, 0, anchors[0].span.start)

  // 相邻锚点之间的空隙。
  for (let k = 0; k < anchors.length - 1; k++) {
    const left = anchors[k]
    const right = anchors[k + 1]
    if (right.index - left.index > 1) {
      fillRange(spans, left.index + 1, right.index, left.span.end, right.span.start)
    }
  }

  // 末个锚点之后：铺到音频结束。
  const last = anchors[anchors.length - 1]
  fillRange(spans, last.index + 1, gptChars.length, last.span.end, Math.max(duration, last.span.end))

  return { spans, matchRate: anchors.length / gptChars.length }
}

/** 在 [from, to) 上把 [startTime, endTime] 均匀切成等长区间。 */
function fillRange(
  spans: CharSpan[],
  from: number,
  to: number,
  startTime: number,
  endTime: number,
): void {
  const count = to - from
  if (count <= 0) return

  const step = Math.max(0, endTime - startTime) / count
  for (let i = 0; i < count; i++) {
    spans[from + i] = { start: startTime + step * i, end: startTime + step * (i + 1) }
  }
}
