export type SpeechLang = 'en' | 'jp' | string

const LANG_MAP: Record<string, string> = {
  en: 'en-GB',
  jp: 'ja-JP',
}

const STORAGE_KEY = 'preferred-voices-v1'

const PREMIUM_HINTS = [
  'premium',
  'enhanced',
  'neural',
  'siri',
  'natural',
]

type VoicePreference = {
  nameIncludes?: string[]
  exactLang?: string
}

const LANG_VOICE_PREFERENCES: Record<string, VoicePreference> = {
  en: { nameIncludes: ['google'], exactLang: 'en-GB' },
  jp: { nameIncludes: ['google'], exactLang: 'ja-JP' },
}

export function isSpeechSupported() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

export function resolveBcp47(lang: SpeechLang) {
  return LANG_MAP[lang] ?? lang
}

export function getAllVoices(): SpeechSynthesisVoice[] {
  if (!isSpeechSupported()) return []
  return window.speechSynthesis.getVoices()
}

export function getVoicesForLang(lang: SpeechLang): SpeechSynthesisVoice[] {
  const bcp47 = resolveBcp47(lang)
  const prefix = bcp47.split('-')[0]
  return getAllVoices().filter(
    (voice) => voice.lang === bcp47 || voice.lang.startsWith(`${prefix}-`),
  )
}

function loadPreferred(): Record<string, string> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Record<string, string>) : {}
  } catch {
    return {}
  }
}

function savePreferred(map: Record<string, string>) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
  } catch {
    // ignore quota errors
  }
}

export function getPreferredVoiceName(lang: SpeechLang): string | null {
  const map = loadPreferred()
  return map[lang] ?? null
}

export function setPreferredVoiceName(lang: SpeechLang, voiceName: string | null) {
  const map = loadPreferred()
  if (voiceName) {
    map[lang] = voiceName
  } else {
    delete map[lang]
  }
  savePreferred(map)
}

function scoreVoice(voice: SpeechSynthesisVoice): number {
  const name = voice.name.toLowerCase()
  let score = 0
  if (voice.localService) score += 1
  for (const hint of PREMIUM_HINTS) {
    if (name.includes(hint)) score += 5
  }
  return score
}

function matchesPreference(
  voice: SpeechSynthesisVoice,
  preference: VoicePreference | undefined,
): boolean {
  if (!preference) return false
  const name = voice.name.toLowerCase()
  const nameMatch =
    !preference.nameIncludes ||
    preference.nameIncludes.length === 0 ||
    preference.nameIncludes.some((token) => name.includes(token.toLowerCase()))
  const langMatch = !preference.exactLang || voice.lang === preference.exactLang
  return nameMatch && langMatch
}

function pickVoice(lang: SpeechLang): SpeechSynthesisVoice | undefined {
  const preferredName = getPreferredVoiceName(lang)
  const candidates = getVoicesForLang(lang)
  if (preferredName) {
    const match = candidates.find((voice) => voice.name === preferredName)
    if (match) return match
  }
  if (candidates.length === 0) return undefined
  const preference = LANG_VOICE_PREFERENCES[lang as string]
  const preferred = candidates.filter((voice) => matchesPreference(voice, preference))
  if (preferred.length > 0) {
    return [...preferred].sort((a, b) => scoreVoice(b) - scoreVoice(a))[0]
  }
  // Fall back to brand-only match (any Google voice for the language family).
  if (preference?.nameIncludes && preference.nameIncludes.length > 0) {
    const brandOnly = candidates.filter((voice) =>
      preference.nameIncludes!.some((token) =>
        voice.name.toLowerCase().includes(token.toLowerCase()),
      ),
    )
    if (brandOnly.length > 0) {
      return [...brandOnly].sort((a, b) => scoreVoice(b) - scoreVoice(a))[0]
    }
  }
  return [...candidates].sort((a, b) => scoreVoice(b) - scoreVoice(a))[0]
}

function isAllKana(input: string) {
  // Hiragana, katakana, prolonged sound mark, common punctuation/whitespace
  return /^[぀-ヿㇰ-ㇿー\s・,，、。.!?！？]+$/.test(input.trim())
}

/**
 * For Japanese: if a kana-only `reading` is supplied, speak that instead of
 * the kanji `text` (kanji can have multiple readings — TTS picks one which may
 * differ from the displayed reading). For other languages: always use `text`,
 * since `reading` is typically IPA which can't be spoken.
 */
export function pickSpeakableText(
  text: string,
  reading: string | undefined | null,
  lang: SpeechLang,
): string {
  if (lang === 'jp' && reading && isAllKana(reading)) return reading
  return text
}

/** 同语言里挑一个本地合成的音色，排除掉刚失败的那个。 */
function pickLocalVoice(
  lang: SpeechLang,
  excludeName?: string,
): SpeechSynthesisVoice | undefined {
  const local = getVoicesForLang(lang).filter(
    (voice) => voice.localService && voice.name !== excludeName,
  )
  if (local.length === 0) return undefined
  return [...local].sort((a, b) => scoreVoice(b) - scoreVoice(a))[0]
}

function speakWith(
  text: string,
  lang: SpeechLang,
  rate: number,
  voice: SpeechSynthesisVoice | undefined,
  allowFallback: boolean,
) {
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = voice?.lang ?? resolveBcp47(lang)
  utterance.rate = rate
  utterance.pitch = 1
  if (voice) utterance.voice = voice

  utterance.onerror = (event) => {
    // cancel() 会给上一条发 canceled/interrupted —— 那是我们自己打断的，
    // 不是失败，重播的话等于把刚取消的内容再念一遍。
    if (event.error === 'canceled' || event.error === 'interrupted') return
    if (!allowFallback) return
    // 首选音色念不出来，换一个本地合成的再试一次。最常见的情况是选中的是
    // Google 那类联网音色（localService === false）—— 它要连 Google 的服务器，
    // 连不上时整个调用悄无声息，用户看到的就是「点了没反应」。
    const fallback = pickLocalVoice(lang, voice?.name)
    if (!fallback) return
    speakWith(text, lang, rate, fallback, false)
  }

  window.speechSynthesis.speak(utterance)
}

export function speak(text: string, lang: SpeechLang = 'en', rate = 0.95) {
  if (!text || !isSpeechSupported()) return
  window.speechSynthesis.cancel()
  speakWith(text, lang, rate, pickVoice(lang), true)
}

export function stopSpeaking() {
  if (!isSpeechSupported()) return
  window.speechSynthesis.cancel()
}

let isPrimed = false

/** Chrome's autoplay policy blocks the first speechSynthesis.speak() until
 *  the document has received a user gesture. By the time the review page's
 *  auto-speak effect fires (after route change + data fetch + render), that
 *  gesture has "expired" and the speak is dropped silently. To work around
 *  it, we attach a one-shot listener on app mount that fires a near-silent
 *  utterance on the very first click/keydown anywhere — that counts as
 *  consuming the gesture, leaving the engine unlocked for all subsequent
 *  calls. Idempotent: once primed, this is a no-op. */
export function primeSpeechOnFirstGesture() {
  if (!isSpeechSupported() || isPrimed) return () => {}
  const synth = window.speechSynthesis
  const onGesture = () => {
    if (isPrimed) return
    isPrimed = true
    const utterance = new SpeechSynthesisUtterance(' ')
    utterance.volume = 0
    try {
      synth.speak(utterance)
    } catch {
      // ignore
    }
    cleanup()
  }
  const cleanup = () => {
    window.removeEventListener('pointerdown', onGesture)
    window.removeEventListener('keydown', onGesture)
    window.removeEventListener('touchstart', onGesture)
  }
  window.addEventListener('pointerdown', onGesture, { once: true })
  window.addEventListener('keydown', onGesture, { once: true })
  window.addEventListener('touchstart', onGesture, { once: true })
  return cleanup
}

type VoicesChangeCallback = () => void

export function onVoicesChanged(callback: VoicesChangeCallback) {
  if (!isSpeechSupported()) return () => {}
  const synth = window.speechSynthesis
  synth.addEventListener('voiceschanged', callback)
  return () => synth.removeEventListener('voiceschanged', callback)
}
