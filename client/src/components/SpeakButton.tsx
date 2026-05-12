import type { MouseEvent } from 'react'
import { SoundOutlined } from '@ant-design/icons'
import { isSpeechSupported, pickSpeakableText, speak } from '../utils/speech'

type SpeakButtonProps = {
  text: string
  reading?: string | null
  lang: string
  label?: string
  size?: 'sm' | 'md'
  rate?: number
}

export function SpeakButton({
  text,
  reading,
  lang,
  label = '朗读',
  size = 'sm',
  rate,
}: SpeakButtonProps) {
  if (!text) return null
  if (!isSpeechSupported()) return null

  const speakText = pickSpeakableText(text, reading, lang)

  const handleClick = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    speak(speakText, lang, rate)
  }

  return (
    <button
      type="button"
      className={`speak-button speak-button-${size}`}
      onClick={handleClick}
      aria-label={`朗读 ${speakText}`}
      title={label}
    >
      <SoundOutlined aria-hidden="true" />
    </button>
  )
}
