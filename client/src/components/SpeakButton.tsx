import type { MouseEvent } from 'react'
import { isSpeechSupported, speak } from '../utils/speech'

type SpeakButtonProps = {
  text: string
  lang: string
  label?: string
  size?: 'sm' | 'md'
  rate?: number
}

export function SpeakButton({
  text,
  lang,
  label = '朗读',
  size = 'sm',
  rate,
}: SpeakButtonProps) {
  if (!text) return null
  if (!isSpeechSupported()) return null

  const handleClick = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    speak(text, lang, rate)
  }

  return (
    <button
      type="button"
      className={`speak-button speak-button-${size}`}
      onClick={handleClick}
      aria-label={`朗读 ${text}`}
      title={label}
    >
      <span aria-hidden="true">🔊</span>
    </button>
  )
}
