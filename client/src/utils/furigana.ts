/**
 * Lazy-loaded Japanese tokenizer + furigana renderer.
 *
 * Backed by kuromoji.js with its dict served from jsdelivr CDN. The dict is
 * ~12MB so we only initialize on demand (when the user opens a Japanese
 * podcast page) and cache the tokenizer for the rest of the session.
 */
import type { Tokenizer, IpadicFeatures } from 'kuromoji'

const DICT_PATH = 'https://cdn.jsdelivr.net/npm/kuromoji@0.1.2/dict/'

let tokenizerPromise: Promise<Tokenizer<IpadicFeatures>> | null = null

export function getTokenizer(): Promise<Tokenizer<IpadicFeatures>> {
  if (tokenizerPromise) return tokenizerPromise
  tokenizerPromise = new Promise((resolve, reject) => {
    // Dynamic import so kuromoji's ~700KB code chunk is split out of the
    // initial bundle.
    void import('kuromoji').then((mod) => {
      const builder = mod.default.builder({ dicPath: DICT_PATH })
      builder.build((err, tokenizer) => {
        if (err) {
          tokenizerPromise = null // allow retry
          reject(err)
          return
        }
        resolve(tokenizer)
      })
    })
  })
  return tokenizerPromise
}

function katakanaToHiragana(s: string): string {
  let out = ''
  for (const c of s) {
    const code = c.charCodeAt(0)
    if (code >= 0x30a1 && code <= 0x30f6) {
      out += String.fromCharCode(code - 0x60)
    } else {
      out += c
    }
  }
  return out
}

function hasKanji(s: string): boolean {
  for (const c of s) {
    const code = c.charCodeAt(0)
    if (code >= 0x4e00 && code <= 0x9faf) return true
  }
  return false
}

function isHiragana(c: string): boolean {
  const code = c.charCodeAt(0)
  return code >= 0x3041 && code <= 0x3096
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** Wrap a kanji-containing token into <ruby>...</ruby>, splitting trailing
 *  okurigana (hiragana tail) so the reading sits over the kanji part only. */
function rubyToken(surface: string, reading: string): string {
  // Find leading non-hiragana span (kanji + any others) and trailing hiragana.
  let tailStart = surface.length
  for (let i = surface.length - 1; i >= 0; i--) {
    if (!isHiragana(surface[i])) break
    tailStart = i
  }
  const head = surface.slice(0, tailStart)
  const tail = surface.slice(tailStart)
  const hiraReading = katakanaToHiragana(reading)
  if (!head) return escapeHtml(surface)

  // If the reading ends with the okurigana tail, strip it from reading too.
  let furi = hiraReading
  if (tail && furi.endsWith(tail)) {
    furi = furi.slice(0, furi.length - tail.length)
  }
  if (!furi || furi === head) {
    return escapeHtml(surface)
  }
  return `<ruby>${escapeHtml(head)}<rt>${escapeHtml(furi)}</rt></ruby>${escapeHtml(tail)}`
}

/** Tokenize a Japanese line and return an HTML string with <ruby> annotations
 *  over kanji-containing tokens. */
export function renderFuriganaHtml(
  tokenizer: Tokenizer<IpadicFeatures>,
  line: string,
): string {
  const tokens = tokenizer.tokenize(line)
  let out = ''
  for (const t of tokens) {
    const surface = t.surface_form
    if (!surface) continue
    const reading = t.reading && t.reading !== '*' ? t.reading : ''
    if (reading && hasKanji(surface)) {
      out += rubyToken(surface, reading)
    } else {
      out += escapeHtml(surface)
    }
  }
  return out
}
