/**
 * 用 kuromoji 把 gpt 文本切成形态素，再给每个形态素套上时间。
 *
 * 不直接用 whisper 的 word 边界，是因为它在日语上粒度飘忽 —— 同一条音频里
 * 可能一会儿整句一个 word、一会儿单个假名一个 word。走 IPADIC 形态素分析
 * 拿到的是稳定的词法边界，顺带还有读音和词性，对接词典功能是现成的。
 */

import kuromoji, { type IpadicFeatures, type Tokenizer } from '@sglkc/kuromoji'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { buildReverseIndex, type NormChar } from './normalize.ts'
import type { CharSpan } from './align.ts'

const require = createRequire(import.meta.url)
const KUROMOJI_DICT = join(dirname(require.resolve('@sglkc/kuromoji/package.json')), 'dict')

let tokenizerPromise: Promise<Tokenizer<IpadicFeatures>> | null = null

/** 词典加载要好几秒，整个进程共用一个实例。 */
export function getTokenizer(): Promise<Tokenizer<IpadicFeatures>> {
  if (!tokenizerPromise) {
    tokenizerPromise = new Promise((resolve, reject) => {
      kuromoji.builder({ dicPath: KUROMOJI_DICT }).build((error, tokenizer) => {
        if (error) reject(error)
        else resolve(tokenizer)
      })
    })
  }
  return tokenizerPromise
}

/** 一个带时间的词，直接对应输出里的一个 <span>。 */
export type TimedToken = {
  /** span 的可见文本，含吸附过来的尾随标点 */
  text: string
  /** 形态素表层形，不含标点 */
  surface: string
  /** 片假名读音，IPADIC 未收录时为 undefined */
  reading?: string
  /** 词性大类，如 名詞 / 動詞 / 助詞 */
  pos?: string
  /** 起始毫秒，即 data-m */
  m: number
  /** 持续毫秒，即 data-d */
  d: number
  /** 是否为句末（。！？），render 用它来分段 */
  endsSentence: boolean
}

/** 归一化后不留字符的 token（纯标点、纯空白）不单独成 span，吸附到前一个词尾。 */
const SENTENCE_END_RE = /[。．.!！?？]/u

/**
 * 把文本切成带时间的词。
 *
 * @param text        gpt-transcribe 的原始文本
 * @param normChars   该文本的归一化字符流
 * @param spans       与 normChars 等长的逐字符时间
 */
export async function tokenizeWithTimings(
  text: string,
  normChars: NormChar[],
  spans: CharSpan[],
): Promise<TimedToken[]> {
  const tokenizer = await getTokenizer()
  const reverse = buildReverseIndex(normChars, text.length)
  const tokens = tokenizer.tokenize(text)

  const out: TimedToken[] = []

  for (const token of tokens) {
    // kuromoji 的 word_position 是 1-based 的字符下标。
    const from = token.word_position - 1
    const to = from + token.surface_form.length

    // 收集该 token 覆盖到、且在归一化流里存活的字符的时间。
    let start = Number.POSITIVE_INFINITY
    let end = Number.NEGATIVE_INFINITY
    for (let i = from; i < to && i < reverse.length; i++) {
      const normIndex = reverse[i]
      if (normIndex < 0) continue
      const span = spans[normIndex]
      if (!span) continue
      if (span.start < start) start = span.start
      if (span.end > end) end = span.end
    }

    const isPunctuation = start === Number.POSITIVE_INFINITY

    if (isPunctuation) {
      // 标点没有自己的时间。吸附到前一个词的 span 文本末尾，这样把所有 span
      // 的文本拼起来仍然等于原文，读者看到的是正常排版的日语。
      const previous = out[out.length - 1]
      if (previous) {
        previous.text += token.surface_form
        previous.endsSentence ||= SENTENCE_END_RE.test(token.surface_form)
      }
      continue
    }

    out.push({
      text: token.surface_form,
      surface: token.surface_form,
      reading: token.reading && token.reading !== '*' ? token.reading : undefined,
      pos: token.pos && token.pos !== '*' ? token.pos : undefined,
      m: Math.round(start * 1000),
      d: Math.max(0, Math.round((end - start) * 1000)),
      endsSentence: SENTENCE_END_RE.test(token.surface_form),
    })
  }

  return enforceMonotonic(out)
}

/**
 * 强制时间轴单调不减。
 *
 * LCS 偶尔会在重复词组上把锚点接歪（「はい、はい」这种），导致后一个词的
 * data-m 比前一个还小。Hyperaudio Lite 按顺序推进高亮，时间倒退会让高亮卡住，
 * 所以这里把回退的词钳到前一个词的结束时刻。
 */
function enforceMonotonic(tokens: TimedToken[]): TimedToken[] {
  let floor = 0
  for (const token of tokens) {
    if (token.m < floor) {
      const drift = floor - token.m
      token.m = floor
      token.d = Math.max(0, token.d - drift)
    }
    floor = token.m
  }
  return tokens
}
