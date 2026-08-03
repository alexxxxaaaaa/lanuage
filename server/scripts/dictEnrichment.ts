import kuromoji, { type IpadicFeatures, type Tokenizer } from '@sglkc/kuromoji'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'

export type DictExample = { text: string; translation?: string }
export type DictSense = { glosses: string[]; examples?: DictExample[]; pos?: string }

const require = createRequire(import.meta.url)
const KUROMOJI_DICT = join(dirname(require.resolve('@sglkc/kuromoji/package.json')), 'dict')
const HAS_HAN = /\p{Script=Han}/u
const HAS_KANA = /[ぁ-ゟァ-ヿー]/u
const JAPANESE_WORD = /^[\p{Script=Han}ぁ-ゟァ-ヿー々〆ヵヶ・]+$/u
const KANA_READING = /^[ぁ-ゟー・]+$/u

// Longest alternatives must come first: `助動詞` may not be consumed as `助`.
const POS_ATOM = [
  '形容動詞', '形容动词', '形容詞', '形容词', '代名詞', '代名词', '接続詞', '接续词',
  '感動詞', '感叹词', '助動詞', '助动词', '助数詞', '助数词', '接頭語', '接头词',
  '接尾語', '接尾词', '連体詞', '连体词', '副詞', '副词', '動詞', '动词', '名詞',
  '名词', '自他下一', '自他上一', '自他五', '自他サ', '他下一', '他上一', '自下一',
  '自上一', '自五', '他五', '自サ', '他サ', '形動', '形动', '連体', '连体', '接頭',
  '接头', '接尾', '連語', '连语', '慣用句', '惯用语', '成句', '枕詞', '枕词', '冠詞',
  '冠词', '数詞', '数词', '助詞', '助词', '名', '代', '動', '动', '形', '副', '接',
  '感', '自他', '自', '他', '詞組', '词组',
].join('|')
const POS_PREFIX = new RegExp(
  `^((?:${POS_ATOM})(?:\\s*[·・•?／/+、]\\s*(?:${POS_ATOM}))*)(?:[。.]?$|\\s+)(.*)$`,
)
const NUMBERED_GLOSS = /^\d+[.、．]\s*/

function normalizePos(pos: string): string {
  return pos.replace(/\s*[・•?／/+、]\s*/g, '·').replace(/\s*·\s*/g, '·')
}

/**
 * Recognize only an anchored Japanese dictionary POS label. Requiring either
 * end-of-line or whitespace after the label keeps words such as “副极带气候”
 * and “形象学” from being truncated.
 */
export function splitPosPrefix(line: string): { pos: string; rest: string } | null {
  const bracketed = line.match(/^\[([^\]]+)](?:\s+|$)(.*)$/)
  if (bracketed) {
    const nested = `${bracketed[1]} ${bracketed[2]}`.trimEnd().match(POS_PREFIX)
    if (nested) return { pos: normalizePos(nested[1]), rest: nested[2].trim() }
  }
  // Some source bullets were decoded as a leading question mark.
  const candidate = /^\?(?=(?:自|他|名|形|副|接|感))/.test(line) ? line.slice(1) : line
  const match = candidate.match(POS_PREFIX)
  if (!match) return null
  return { pos: normalizePos(match[1]), rest: match[2].trim() }
}

function scriptCounts(text: string): { kana: number; han: number } {
  let kana = 0
  let han = 0
  for (const char of text) {
    if (HAS_KANA.test(char)) kana++
    else if (HAS_HAN.test(char)) han++
  }
  return { kana, han }
}

/** Deliberately conservative: quoted Japanese inside a Chinese explanation is not an example. */
export function isLikelyJapaneseExample(text: string): boolean {
  const { kana, han } = scriptCounts(text)
  return kana >= 2 && (han === 0 || kana / (kana + han) >= 0.16)
}

export function isLikelyChineseTranslation(text: string): boolean {
  const { kana, han } = scriptCounts(text)
  return han > 0 && (kana === 0 || kana / (kana + han) < 0.08)
}

type WorkingSense = DictSense & { numbered: boolean }

function pushExample(sense: WorkingSense, example: DictExample) {
  if (sense.examples) sense.examples.push(example)
  else sense.examples = [example]
}

/**
 * Rebuild the flattened paragraphs found in Chinese Wiktionary's Japanese
 * entries. Ambiguous lines remain glosses; only a strong ja -> zh adjacent
 * pair becomes an example.
 */
export function enrichZhWiktionarySenses(
  entryPos: string,
  input: DictSense[],
  headword = '',
): { pos: string; senses: DictSense[] } {
  if (entryPos !== 'unknown') return { pos: entryPos, senses: input }

  const foundPos: string[] = []
  const output: DictSense[] = []

  for (const sourceSense of input) {
    let activePos = ''
    let current: WorkingSense | null = null

    const flush = () => {
      if (!current) return
      if (current.glosses.length > 0 || (current.examples?.length ?? 0) > 0) {
        const { numbered: _, ...sense } = current
        output.push(sense)
      }
      current = null
    }

    for (let index = 0; index < sourceSense.glosses.length; index++) {
      let line = sourceSense.glosses[index].trim()
      if (!line) continue

      const marker = splitPosPrefix(line)
      if (marker) {
        flush()
        activePos = marker.pos
        if (!foundPos.includes(activePos)) foundPos.push(activePos)
        line = marker.rest
        if (!line) continue
      }

      const numbered = NUMBERED_GLOSS.test(line)
      if (numbered && current?.numbered) flush()
      if (!current) current = { glosses: [], ...(activePos ? { pos: activePos } : {}), numbered: false }

      const next = sourceSense.glosses[index + 1]?.trim() ?? ''
      const nextMarker = next ? splitPosPrefix(next) : null
      if (
        current.glosses.length > 0 &&
        !numbered &&
        (isLikelyJapaneseExample(line) ||
          (headword.length >= 2 && line.includes(headword) && HAS_HAN.test(line))) &&
        next &&
        !nextMarker &&
        !NUMBERED_GLOSS.test(next) &&
        isLikelyChineseTranslation(next)
      ) {
        pushExample(current, { text: line, translation: next })
        index++
        continue
      }

      current.glosses.push(line)
      if (numbered) current.numbered = true
    }

    if (sourceSense.examples?.length) {
      if (!current) current = { glosses: [], ...(activePos ? { pos: activePos } : {}), numbered: false }
      for (const example of sourceSense.examples) pushExample(current, example)
    }
    flush()
  }

  return { pos: foundPos.length > 0 ? foundPos.join(' / ') : entryPos, senses: output }
}

let tokenizerPromise: Promise<Tokenizer<IpadicFeatures>> | undefined

export function getJapaneseTokenizer(): Promise<Tokenizer<IpadicFeatures>> {
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

function katakanaToHiragana(value: string): string {
  return [...value]
    .map((char) => {
      const code = char.charCodeAt(0)
      return code >= 0x30a1 && code <= 0x30f6 ? String.fromCharCode(code - 0x60) : char
    })
    .join('')
}

/**
 * Infer a reading only when every kanji token is known to IPADIC. This rejects
 * Kuromoji's generic UNKNOWN tokens, which is essential because this source
 * contains Chinese words incorrectly tagged as Japanese.
 */
export function inferJapaneseReading(
  tokenizer: Tokenizer<IpadicFeatures>,
  word: string,
): string {
  if (!HAS_HAN.test(word) || !JAPANESE_WORD.test(word)) return ''
  const tokens = tokenizer.tokenize(word)
  if (tokens.map((token) => token.surface_form).join('') !== word) return ''

  let reading = ''
  for (const token of tokens) {
    if (token.word_type === 'UNKNOWN' && HAS_HAN.test(token.surface_form)) return ''
    if (token.pos_detail_1 === '固有名詞' || token.pos_detail_2 === '人名') return ''
    // A one-kanji token is especially prone to choosing a name reading or the
    // wrong productive-compound reading (臭化 -> においか). Prefer a missing
    // reading to baking that ambiguity into the index.
    if (HAS_HAN.test(token.surface_form) && [...token.surface_form].length === 1) return ''
    const tokenReading = token.reading
    if (!tokenReading || tokenReading === '*') return ''
    reading += katakanaToHiragana(tokenReading)
  }
  return KANA_READING.test(reading) ? reading : ''
}
