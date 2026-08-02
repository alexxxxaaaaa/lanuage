import type { MouseEvent } from 'react'
import { Volume2 } from 'lucide-react'
import { isSpeechSupported, pickSpeakableText, speak } from '../utils/speech'

const SPEAK_BUTTON =
  'inline-flex cursor-pointer items-center justify-center rounded-full border border-accent/25 bg-accent/8 p-0 leading-none text-accent transition-[background-color,transform] duration-150 hover:bg-accent/16 active:scale-92'
const SPEAK_SIZE = {
  sm: 'size-7 min-h-7 text-sm',
  md: 'size-10 min-h-10 text-lg',
} as const

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
      className={`${SPEAK_BUTTON} ${SPEAK_SIZE[size]}`}
      onClick={handleClick}
      aria-label={`朗读 ${speakText}`}
      title={label}
    >
      <Volume2 aria-hidden="true" />
    </button>
  )
}
