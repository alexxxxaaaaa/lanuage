// 文解析：整段日文 → 逐词（学校文法）+ 整句中文翻译，以及点开某个词时的
// 「这个词在这句话里」的详解。
//
// 两条路都刻意把**整句原文**送进 prompt。同形異音語（「行った」= いった /
// おこなった）、多义助词、活用形归原，离了上下文只能靠词频猜，那正是这个页面
// 想避免的错。代价是 prompt 里带一份原文，比逐词单查贵一点，但一次调用摊给
// 整句所有词，实际反而便宜。
//
// 不做服务端缓存：输入是用户随手贴的任意文本，(文本 → 解析) 的命中率约等于零，
// 一张缓存表只会白占一次写。词一级的复用交给前端会话内的 Map（同一个词 + 同一句
// 点第二次不再计费），以及查词那边本来就有的 DictEntry 缓存。

import { AppError } from '../errors/AppError'
import {
  assertWithinDailyBudget,
  completeJsonOrThrow,
  parseModelJsonObject,
  sanitize,
} from '../lib/aiClient'

export type AnalyzeToken = {
  /** 句中原样出现的词形。同一句里所有 word 顺序拼起来必须等于句子原文。 */
  word: string
  /** 学校文法十大品詞的日文标签（名詞/動詞/…），标点是「記号」，判不出为空串。 */
  pos: string
  /** 平假名读音。词里没有汉字（假名词、标点、拉丁字母）时是空串。 */
  kana: string
  /** 辞書形。与 word 相同时是空串 —— 消费方一律 `base || word`。 */
  base: string
}

export type AnalyzeSentence = {
  /** 原文里的这一句，逐字符原样。 */
  text: string
  /** 整句简体中文翻译。这一句没解析成功时是空串。 */
  zh: string
  tokens: AnalyzeToken[]
}

export type AnalyzeTextResult = {
  sentences: AnalyzeSentence[]
  /** 有多少句因为 AI 出错没解析出来 —— 前端据此提示「部分句子解析失败」。 */
  failedCount: number
}

/**
 * 一次能解析多长。整段进 prompt、逐词出 JSON，输出量随字数线性涨，1000 字
 * 一次大约要 2 万 output token —— 已经是日预算的一大截。再长的文章请分段贴。
 */
const MAX_TEXT_CHARS = 1000
/**
 * 一次调用最多塞多少字的句子。切小的三个好处：JSON 不容易被 max token 截断、
 * 失败只丢一块而不是整篇、几块还能并发跑。切太小则 prompt（约 700 token）会被
 * 重复付很多遍，120 字是这两头之间的折中。
 */
const CHUNK_CHARS = 120
/** 同时在飞的调用数。上游限速和日预算都不鼓励再高。 */
const CHUNK_CONCURRENCY = 3

/** 输出预算：结构 + 每字约 24 token 的逐词 JSON，再给整句译文留一点。 */
function chunkTokenBudget(chars: number) {
  return Math.min(4000, 320 + chars * 24)
}

const SENTENCE_END = /[。．！？!?]/
const BRACKET_OPEN = /[「『（(【[]/
const BRACKET_CLOSE = /[」』）)\]】]/

/**
 * 切句。先按行切（换行是作者给的最硬的边界），行内再按句末标点切。
 *
 * 引号和括号里的句号不断句 —— 「そうだ。」と言った 是一句话，不是两句。
 * 连续的句末标点（「！？」「…。」）和紧跟其后的闭引号收进同一句。
 *
 * 切出来的每一句都是原文的一段连续切片：整句翻译、以及下面的 token 对齐，
 * 都建立在「句子文本就是原文」这个前提上。
 */
export function splitSentences(text: string): string[] {
  const out: string[] = []
  for (const line of text.split(/\r?\n/)) {
    let start = 0
    let depth = 0
    for (let i = 0; i < line.length; i++) {
      const char = line[i]
      if (BRACKET_OPEN.test(char)) {
        depth += 1
      } else if (BRACKET_CLOSE.test(char)) {
        depth = Math.max(0, depth - 1)
      } else if (SENTENCE_END.test(char) && depth === 0) {
        let end = i + 1
        while (
          end < line.length &&
          (SENTENCE_END.test(line[end]) || BRACKET_CLOSE.test(line[end]))
        ) {
          end += 1
        }
        out.push(line.slice(start, end))
        start = end
        i = end - 1
      }
    }
    if (start < line.length) out.push(line.slice(start))
  }
  return out.filter((sentence) => sentence.trim().length > 0)
}

/** 连续的句子攒成一块，每块不超过 CHUNK_CHARS 字（单句超长的自成一块）。 */
function chunkSentences(sentences: string[]): string[][] {
  const chunks: string[][] = []
  let current: string[] = []
  let size = 0
  for (const sentence of sentences) {
    if (current.length > 0 && size + sentence.length > CHUNK_CHARS) {
      chunks.push(current)
      current = []
      size = 0
    }
    current.push(sentence)
    size += sentence.length
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}

/** 并发跑，但同时在飞的不超过 limit 个；结果顺序与输入一致。 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  run: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await run(items[index], index)
    }
  })
  await Promise.all(workers)
  return results
}

function buildAnalyzePrompt(sentences: string[]) {
  const list = sentences.map((sentence, i) => `${i + 1}. ${sentence}`).join('\n')
  return [
    '对下面每一句日语做词法分析（日本【学校文法】体系）并翻译。只返回 JSON 对象。',
    '',
    '顶层键 sentences：数组，长度与输入句子数相同，每项 {"i":句号,"zh":"整句中文翻译","tokens":[…]}。',
    'token 形如 {"w":"词形","p":"词性","k":"平假名读音","b":"辞書形"}。',
    '',
    '【原文完整性 —— 最重要】',
    '同一句里所有 w 顺序拼接后，必须与该句原文逐字符完全一致：不省略、不改写、不纠错、不补空格。',
    '「には」「では」这类连续助词要逐个拆开保留。',
    '',
    '【切分 —— 切到学校文法的単語级】',
    '1. 助動詞与动词分开：「食べた」→「食べ」(動詞)＋「た」(助動詞)。',
    '2. 「て形＋补助动词」拆开：「並んでいる」→「並ん」(動詞)＋「で」(助詞)＋「いる」(動詞)。',
    '3. 形容動詞整体一个词，不拆成名詞＋助動詞：「静かだ」「苦手だ」。',
    '4. 助詞独立成词。表否定的「ない」是助動詞，表「不存在」的是形容詞。',
    '',
    '【p 词性】只能取：名詞 代名詞 動詞 形容詞 形容動詞 副詞 連体詞 接続詞 感動詞 助詞 助動詞 記号。标点一律 記号。',
    '',
    '【k 读音】只在词里含汉字时给，且必须结合整句语境选对读音（「行った」いった/おこなった、「一日」ついたち/いちにち 之类同形異音語尤其注意）；纯假名、标点、拉丁字母一律给空串 ""。平假名书写。',
    '',
    '【b 辞書形】只在与 w 不同时给（活用形还原：「食べ」→「食べる」、「高く」→「高い」、「し」→「する」；助動詞「た」→「た」不变则空串）；相同时给空串 ""。',
    '',
    '【zh 翻译】该句的简体中文翻译，通顺口语化，不要逐字硬译。',
    '',
    '示例：{"sentences":[{"i":1,"zh":"我昨天看了电影。","tokens":[{"w":"映画","p":"名詞","k":"えいが","b":""},{"w":"を","p":"助詞","k":"","b":""},{"w":"見","p":"動詞","k":"み","b":"見る"},{"w":"まし","p":"助動詞","k":"","b":"ます"},{"w":"た","p":"助動詞","k":"","b":""},{"w":"。","p":"記号","k":"","b":""}]}]}',
    '',
    '待解析：',
    list,
  ].join('\n')
}

/** 模型回来的原始 token。字段短是为了省 output token，进程内立刻展开成 AnalyzeToken。 */
export type RawToken = { w?: unknown; p?: unknown; k?: unknown; b?: unknown }
type RawSentence = { i?: unknown; zh?: unknown; tokens?: unknown }

/**
 * 把模型给的 token 序列对齐回原句。
 *
 * 模型偶尔会漏一个助词、吞掉标点、或把「ヶ月」写成「ケ月」。渲染的是原文，
 * 所以这里以原句为准走一遍：对不上的丢掉，漏掉的那段原文补成一个没有词性的
 * token（前端画灰色下划线，照样点得开）。这样「拼起来等于原文」是代码保证的，
 * 不是靠 prompt 求来的。
 */
export function alignTokens(source: string, raw: RawToken[]): AnalyzeToken[] {
  const out: AnalyzeToken[] = []
  let pos = 0
  const gap = (text: string) => {
    if (!text) return
    // 纯空白的缺口（模型不回原文里的空格）当标点处理：原样占位，不画下划线、
    // 也点不开 —— 它不是一个词。
    out.push({ word: text, pos: text.trim() ? '' : '記号', kana: '', base: '' })
  }

  for (const item of raw) {
    const word = typeof item.w === 'string' ? item.w : ''
    if (!word) continue
    const at = source.indexOf(word, pos)
    if (at === -1) continue
    gap(source.slice(pos, at))
    const base = sanitize(typeof item.b === 'string' ? item.b : '')
    out.push({
      word,
      pos: sanitize(typeof item.p === 'string' ? item.p : ''),
      kana: sanitize(typeof item.k === 'string' ? item.k : ''),
      // 模型常把 b 原样回一遍 word，这里收敛成「不同才有值」的口径。
      base: base && base !== word ? base : '',
    })
    pos = at + word.length
  }
  gap(source.slice(pos))
  return out
}

/** 整句没解析出来时的兜底：原文当成一个词，前端照样渲染得出来。 */
function unanalyzed(text: string): AnalyzeSentence {
  return { text, zh: '', tokens: [{ word: text, pos: '', kana: '', base: '' }] }
}

async function analyzeChunk(
  sentences: string[],
  userId: string,
): Promise<AnalyzeSentence[]> {
  const chars = sentences.reduce((sum, sentence) => sum + sentence.length, 0)
  const content = await completeJsonOrThrow({
    system:
      'You are a Japanese morphological analyzer for Chinese learners. Return strict JSON only.',
    user: buildAnalyzePrompt(sentences),
    maxOutputTokens: chunkTokenBudget(chars),
    log: {
      word: sentences[0].slice(0, 40),
      language: 'jp',
      feature: 'text_analyze',
      userId,
    },
  })

  const parsed = parseModelJsonObject<{ sentences?: unknown }>(content)
  const rows = Array.isArray(parsed.sentences) ? (parsed.sentences as RawSentence[]) : []
  // 按 i 归位，而不是按返回顺序：模型漏掉中间一句时，顺序对齐会让后面全体错位。
  const byIndex = new Map<number, RawSentence>()
  rows.forEach((row, fallback) => {
    const index = typeof row?.i === 'number' ? row.i - 1 : fallback
    if (index >= 0 && index < sentences.length && !byIndex.has(index)) {
      byIndex.set(index, row)
    }
  })

  return sentences.map((text, index) => {
    const row = byIndex.get(index)
    const raw = Array.isArray(row?.tokens) ? (row.tokens as RawToken[]) : []
    if (raw.length === 0) return unanalyzed(text)
    return {
      text,
      zh: sanitize(typeof row?.zh === 'string' ? row.zh : ''),
      tokens: alignTokens(text, raw),
    }
  })
}

export async function analyzeText(input: {
  text: string
  userId: string
}): Promise<AnalyzeTextResult> {
  const text = input.text.trim()
  if (!text) throw new AppError('text is required', 400)
  if (text.length > MAX_TEXT_CHARS) {
    throw new AppError(`一次最多解析 ${MAX_TEXT_CHARS} 字，请分段解析`, 400)
  }

  const sentences = splitSentences(text)
  if (sentences.length === 0) throw new AppError('text is required', 400)

  await assertWithinDailyBudget(input.userId)

  const chunks = chunkSentences(sentences)
  const settled = await mapWithConcurrency(chunks, CHUNK_CONCURRENCY, async (chunk) => {
    try {
      return await analyzeChunk(chunk, input.userId)
    } catch (error) {
      // 一块失败不该让整篇白解析：这一块退化成未解析的原文，其余照常返回。
      // 全部失败的情况在下面统一报错。
      console.warn('analyzeChunk failed:', error)
      return null
    }
  })

  if (settled.every((chunk) => chunk === null)) {
    throw new AppError('AI 解析失败，请稍后重试', 502)
  }

  const result: AnalyzeSentence[] = []
  let failedCount = 0
  settled.forEach((chunk, index) => {
    if (chunk) {
      result.push(...chunk)
    } else {
      failedCount += chunks[index].length
      result.push(...chunks[index].map(unanalyzed))
    }
  })

  return { sentences: result, failedCount }
}

// ===== 单词详解（点开解析结果里的某个词） =====

export type AnalyzeWordResult = {
  /** 句中形，原样回显。 */
  word: string
  kana: string
  /** 辞書形。查词区块、JLPT 级别都按它走。 */
  base: string
  /** 中文词性（名词/助词/…）。 */
  pos: string
  /** 该词在这句话里的意思，一句话。 */
  meaning: string
  /** 详细语法解释，【】高亮术语，可能多行。 */
  explanation: string
}

const MAX_WORD_EXPLAIN_TOKENS = 520
/** 整句进 prompt，长句截断防御脏数据（正常句子远到不了）。 */
const SENTENCE_LIMIT = 300

function buildWordExplainPrompt(input: {
  word: string
  pos: string
  kana: string
  base: string
  sentence: string
}) {
  const hints = [
    input.pos ? `词性参考：${input.pos}` : '',
    input.kana ? `读音参考：${input.kana}` : '',
    input.base && input.base !== input.word ? `辞書形参考：${input.base}` : '',
  ].filter(Boolean)

  return [
    '只返回 JSON 对象，键：word, kana, base, pos, meaning, explanation。',
    'word: 原样回显下面的「目标词」，不要改写。',
    'kana: 该词在这句话里的平假名读音（同形異音語按语境选；纯假名词也照给读音）。',
    'base: 辞書形/原形。活用形要还原（食べまし→食べる、高く→高い）；助詞等无活用的词原样返回。',
    'pos: 简体中文词性，如 名词 / 动词 / 形容词 / 形容动词 / 副词 / 连体词 / 接续词 / 感叹词 / 助词 / 助动词 / 标点。',
    'meaning: 该词在这句话里的意思，简体中文，<=30 字，不要罗列词典上的全部义项。',
    'explanation: 简体中文详细解释，<=200 字，必须包含：',
    '  a. 助词/助动词讲清它在本句里的具体功能；',
    '  b. 有活用的讲清是哪一种活用、怎么变过来的（如「五段动词 + て形音便」）；',
    '  c. 它在句子结构里充当什么成分；',
    '  d. 末尾给 1 个简短例句（日文＋中文），展示同一用法。',
    '  语法术语、词形、活用名用【】括起来高亮。换行用 JSON 标准换行转义。',
    '',
    hints.length > 0 ? hints.join('\n') : '',
    `目标词：${input.word}`,
    `所在句子：${input.sentence}`,
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * 「这个词在这句话里是什么意思」。
 *
 * 整句必传 —— 没有它，多义助词和活用形只能按词频猜，那就是普通查词，
 * 页面上已经有一个查词区块在做这件事了。
 */
export async function explainWordInSentence(input: {
  word: string
  pos?: string
  kana?: string
  base?: string
  sentence: string
  userId: string
}): Promise<AnalyzeWordResult> {
  const word = sanitize(input.word)
  const sentence = sanitize(input.sentence).slice(0, SENTENCE_LIMIT)
  if (!word) throw new AppError('word is required', 400)
  if (!sentence) throw new AppError('sentence is required', 400)

  await assertWithinDailyBudget(input.userId)

  const content = await completeJsonOrThrow({
    system:
      'You are a Japanese grammar tutor for Chinese learners. Explain concisely and specifically. Return strict JSON only.',
    user: buildWordExplainPrompt({
      word,
      pos: sanitize(input.pos),
      kana: sanitize(input.kana),
      base: sanitize(input.base),
      sentence,
    }),
    maxOutputTokens: MAX_WORD_EXPLAIN_TOKENS,
    log: { word, language: 'jp', feature: 'text_analyze_word', userId: input.userId },
  })

  const parsed = parseModelJsonObject<Partial<Record<keyof AnalyzeWordResult, unknown>>>(
    content,
  )
  const text = (value: unknown) => sanitize(typeof value === 'string' ? value : '')
  const base = text(parsed.base)
  return {
    word,
    kana: text(parsed.kana) || sanitize(input.kana),
    // 兜底顺序：模型的原形 → 前端传来的解析原形 → 词形本身。查词区块拿它当
    // 词头，空着的话那一整块就查不出东西来。
    base: base || sanitize(input.base) || word,
    pos: text(parsed.pos) || sanitize(input.pos),
    meaning: text(parsed.meaning),
    explanation: text(parsed.explanation),
  }
}
