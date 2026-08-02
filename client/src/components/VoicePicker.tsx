import { useEffect, useMemo, useState } from 'react'
import { Button } from '@heroui/react'
import { SelectField } from './ui/SelectField'
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
    <div className="flex flex-wrap items-center gap-2.5 rounded-xl border border-accent/20 bg-accent/5 px-3.5 py-2.5">
      <span className="text-[13px] font-semibold whitespace-nowrap text-foreground">
        朗读音色
      </span>
      <SelectField
        aria-label="朗读音色"
        className="min-w-[220px] flex-1"
        options={[
          { value: '', label: '自动(推荐)' },
          ...voices.map((voice) => ({
            value: voice.name,
            label: `${voice.name} · ${voice.lang}`,
          })),
        ]}
        value={selected}
        onChange={handleChange}
      />
      <Button size="sm" variant="outline" onPress={() => speak(preview, lang)}>
        试听
      </Button>
    </div>
  )
}
