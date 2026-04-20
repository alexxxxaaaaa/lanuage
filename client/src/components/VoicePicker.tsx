import { useEffect, useMemo, useState } from 'react'
import {
  getPreferredVoiceName,
  getVoicesForLang,
  isSpeechSupported,
  onVoicesChanged,
  setPreferredVoiceName,
  speak,
  type SpeechLang,
} from '../utils/speech'

type VoicePickerProps = {
  lang: SpeechLang
  sampleText?: string
}

const FALLBACK_SAMPLES: Record<string, string> = {
  en: 'This is a voice preview.',
  jp: 'これは音声のプレビューです。',
}

export function VoicePicker({ lang, sampleText }: VoicePickerProps) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [selected, setSelected] = useState<string>('')

  useEffect(() => {
    if (!isSpeechSupported()) return
    const refresh = () => {
      setVoices(getVoicesForLang(lang))
      setSelected(getPreferredVoiceName(lang) ?? '')
    }
    refresh()
    return onVoicesChanged(refresh)
  }, [lang])

  const preview = useMemo(
    () => sampleText ?? FALLBACK_SAMPLES[lang] ?? 'Hello',
    [lang, sampleText],
  )

  if (!isSpeechSupported() || voices.length === 0) return null

  const handleChange = (value: string) => {
    setSelected(value)
    setPreferredVoiceName(lang, value || null)
    setTimeout(() => speak(preview, lang), 0)
  }

  return (
    <div className="voice-picker">
      <label className="voice-picker-label" htmlFor={`voice-${lang}`}>
        朗读音色
      </label>
      <select
        id={`voice-${lang}`}
        value={selected}
        onChange={(event) => handleChange(event.target.value)}
      >
        <option value="">自动（推荐）</option>
        {voices.map((voice) => (
          <option key={`${voice.name}-${voice.lang}`} value={voice.name}>
            {voice.name} · {voice.lang}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="ghost-button"
        onClick={() => speak(preview, lang)}
      >
        试听
      </button>
    </div>
  )
}
