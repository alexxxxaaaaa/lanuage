import { useState } from 'react'
import {
  submitGrammarQuestionAttempt,
  type GrammarQuestion,
} from '../api/grammarQuestions'
import { Button } from '@heroui/react'

// 选项按钮。disabled:cursor-default 覆盖全局 button 的 pointer。
const OPTION =
  'flex min-h-0 cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 text-left text-[0.95rem] font-normal text-inherit transition-[background-color,border-color] duration-150 disabled:cursor-default'

type Props = {
  question: GrammarQuestion
  onAnswered?: (result: { isCorrect: boolean; selectedIndex: number }) => void
}

const CHOICE_LABELS = ['A', 'B', 'C', 'D']

// One MCQ card. Server call to /attempt on selection so it lands in the wrong-
// questions view; local state tracks the current pick + whether we've revealed.
export function GrammarQuestionCard({ question, onAnswered }: Props) {
  const initialSelected = question.attempt?.selectedIndex ?? null
  const [selected, setSelected] = useState<number | null>(initialSelected)
  const [revealed, setRevealed] = useState<boolean>(initialSelected !== null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handlePick = async (idx: number) => {
    if (isSubmitting || revealed) return
    setIsSubmitting(true)
    setSelected(idx)
    try {
      const result = await submitGrammarQuestionAttempt(question.id, idx)
      setRevealed(true)
      onAnswered?.({ isCorrect: result.isCorrect, selectedIndex: idx })
    } catch {
      // On failure roll back so the user can retry.
      setSelected(null)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleRetry = () => {
    setSelected(null)
    setRevealed(false)
  }

  return (
    <div className="rounded-[10px] border border-black/8 bg-neutral-50 px-4 py-3.5">
      <p className="mx-0 mt-0 mb-3 font-serif text-base/[1.7] whitespace-pre-wrap">
        {question.prompt}
      </p>
      <div className="flex flex-col gap-1.5">
        {question.options.map((opt, idx) => {
          const isPicked = selected === idx
          const isAnswer = revealed && idx === question.answerIndex
          const isWrongPick = revealed && isPicked && idx !== question.answerIndex
          return (
            <button
              key={idx}
              type="button"
              className={`${OPTION} ${
                isAnswer
                  ? 'border-green-500 bg-green-100'
                  : isWrongPick
                    ? 'border-red-500 bg-red-100'
                    : isPicked && !revealed
                      ? 'border-[#6d8dcf] bg-[#eef4ff]'
                      : 'border-black/10 bg-white not-disabled:hover:border-[#b5cdff] not-disabled:hover:bg-[#f2f6ff]'
              }`}
              onClick={() => void handlePick(idx)}
              disabled={isSubmitting || revealed}
            >
              <span
                className={`min-w-[18px] font-bold ${
                  isAnswer ? 'text-green-700' : isWrongPick ? 'text-red-700' : 'text-foreground'
                }`}
              >
                {CHOICE_LABELS[idx]}
              </span>
              <span className="flex-1 font-serif [overflow-wrap:anywhere]">{opt}</span>
            </button>
          )
        })}
      </div>
      {revealed ? (
        <div className="mt-2.5 flex items-center gap-3 text-[0.9rem]">
          <span
            className={
              selected === question.answerIndex
                ? 'font-semibold text-green-700'
                : 'font-semibold text-red-700'
            }
          >
            {selected === question.answerIndex ? '正确' : '错误'}
          </span>
          <Button variant="ghost" size="sm" className="h-auto min-h-0 px-1 underline"
            type="button" onPress={handleRetry}
          >
            再答一次
          </Button>
        </div>
      ) : null}
    </div>
  )
}
