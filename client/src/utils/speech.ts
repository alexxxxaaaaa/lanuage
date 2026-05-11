export type SpeechLang = 'en' | 'jp' | string

const LANG_MAP: Record<string, string> = {
  en: 'en-US',
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

function pickVoice(lang: SpeechLang): SpeechSynthesisVoice | undefined {
  const preferredName = getPreferredVoiceName(lang)
  const candidates = getVoicesForLang(lang)
  if (preferredName) {
    const match = candidates.find((voice) => voice.name === preferredName)
    if (match) return match
  }
  if (candidates.length === 0) return undefined
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

export function speak(text: string, lang: SpeechLang = 'en', rate = 0.95) {
  if (!text || !isSpeechSupported()) return

  const synth = window.speechSynthesis
  synth.cancel()

  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = resolveBcp47(lang)
  utterance.rate = rate
  utterance.pitch = 1

  const voice = pickVoice(lang)
  if (voice) {
    utterance.voice = voice
    utterance.lang = voice.lang
  }

  synth.speak(utterance)
}

export function stopSpeaking() {
  if (!isSpeechSupported()) return
  window.speechSynthesis.cancel()
}

type VoicesChangeCallback = () => void

export function onVoicesChanged(callback: VoicesChangeCallback) {
  if (!isSpeechSupported()) return () => {}
  const synth = window.speechSynthesis
  synth.addEventListener('voiceschanged', callback)
  return () => synth.removeEventListener('voiceschanged', callback)
}
