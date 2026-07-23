import { useState } from 'react'
import {
  submitGrammarQuestionAttempt,
  type GrammarQuestion,
} from '../api/grammarQuestions'

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
    <div className="grammar-question-card">
      <p className="grammar-question-prompt" style={{ fontFamily: 'serif' }}>
        {question.prompt}
      </p>
      <div className="grammar-question-options">
        {question.options.map((opt, idx) => {
          const isPicked = selected === idx
          const isAnswer = revealed && idx === question.answerIndex
          const isWrongPick = revealed && isPicked && idx !== question.answerIndex
          const cls = [
            'grammar-question-option',
            isPicked ? 'is-picked' : '',
            isAnswer ? 'is-correct' : '',
            isWrongPick ? 'is-wrong' : '',
            revealed ? 'is-revealed' : '',
          ]
            .filter(Boolean)
            .join(' ')
          return (
            <button
              key={idx}
              type="button"
              className={cls}
              onClick={() => void handlePick(idx)}
              disabled={isSubmitting || revealed}
            >
              <span className="grammar-question-option-label">
                {CHOICE_LABELS[idx]}
              </span>
              <span className="grammar-question-option-text" style={{ fontFamily: 'serif' }}>
                {opt}
              </span>
            </button>
          )
        })}
      </div>
      {revealed ? (
        <div className="grammar-question-footer">
          <span
            className={
              selected === question.answerIndex
                ? 'grammar-question-verdict-correct'
                : 'grammar-question-verdict-wrong'
            }
          >
            {selected === question.answerIndex ? '正确' : '错误'}
          </span>
          <button type="button" onClick={handleRetry} className="link-button">
            再答一次
          </button>
        </div>
      ) : null}
    </div>
  )
}
