import { useState } from 'react'
import {
  submitGrammarQuestionAttempt,
  updateGrammarQuestionNote,
  type GrammarQuestion,
} from '../api/grammarQuestions'
import { Button, TextArea } from '@heroui/react'

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

  // 备注。note 在本地留一份副本，存完就地更新，不用把整个列表重拉一遍。
  // isNoteOpen 每次挂载都从 false 起 —— 备注里常写着「为什么选B」，等于答案，
  // 重刷这道题时不该一进来就看见。
  const [note, setNote] = useState(question.note)
  const [isNoteOpen, setIsNoteOpen] = useState(false)
  const [isEditingNote, setIsEditingNote] = useState(false)
  const [noteDraft, setNoteDraft] = useState('')
  const [isSavingNote, setIsSavingNote] = useState(false)
  const [noteError, setNoteError] = useState<string | null>(null)

  const openNoteEditor = () => {
    setNoteDraft(note)
    setIsEditingNote(true)
    setNoteError(null)
  }

  const saveNote = async () => {
    setIsSavingNote(true)
    setNoteError(null)
    try {
      const saved = await updateGrammarQuestionNote(question.id, noteDraft)
      setNote(saved)
      setIsEditingNote(false)
    } catch {
      setNoteError('保存失败，再试一次')
    } finally {
      setIsSavingNote(false)
    }
  }

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
    <div className="rounded-[10px] bg-surface-secondary px-4 py-3.5">
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
                  ? 'border-success/40 bg-success-soft'
                  : isWrongPick
                    ? 'border-danger/40 bg-danger-soft'
                    : isPicked && !revealed
                      ? 'border-accent/40 bg-accent-soft'
                      : 'border-border bg-surface not-disabled:hover:border-accent/30 not-disabled:hover:bg-accent-soft'
              }`}
              onClick={() => void handlePick(idx)}
              disabled={isSubmitting || revealed}
            >
              <span
                className={`min-w-[18px] font-bold ${
                  isAnswer
                    ? 'text-success-soft-foreground'
                    : isWrongPick
                      ? 'text-danger-soft-foreground'
                      : 'text-foreground'
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
        <div className="mt-2.5 flex flex-col gap-1.5">
          <div className="flex items-center gap-3 text-[0.9rem]">
            <span
              className={
                selected === question.answerIndex
                  ? 'font-semibold text-success-soft-foreground'
                  : 'font-semibold text-danger-soft-foreground'
              }
            >
              {selected === question.answerIndex ? '正确' : '错误'}
            </span>
            <Button variant="ghost" size="sm" className="h-auto min-h-0 px-1 underline"
              type="button" onPress={handleRetry}
            >
              再答一次
            </Button>
            {/* 有备注时按钮带个点，这样不展开也知道自己写过东西 */}
            <Button variant="ghost" size="sm" className="h-auto min-h-0 px-1 underline"
              type="button"
              onPress={() => {
                setIsNoteOpen((open) => !open)
                setIsEditingNote(false)
              }}
            >
              {isNoteOpen ? '隐藏备注' : note ? '备注 ●' : '加备注'}
            </Button>
          </div>
          {/* 考点只在答完后露出 —— 提前显示等于把答案告诉人。没标注的题
            * （testedPoint 为空）整行不渲染，不留占位空行。 */}
          {question.testedPoint ? (
            <div className="flex items-baseline gap-2 text-[0.85rem]">
              <span className="shrink-0 text-muted">考点</span>
              <span className="font-serif font-semibold [overflow-wrap:anywhere]">
                {question.testedPoint}
              </span>
            </div>
          ) : null}

          {isNoteOpen ? (
            <div className="rounded-lg border border-border bg-surface px-2.5 py-2 text-[0.85rem]">
              {isEditingNote ? (
                <div className="grid gap-2">
                  <TextArea
                    value={noteDraft}
                    onChange={(e) => setNoteDraft(e.target.value)}
                    rows={3}
                    autoFocus
                    placeholder="为什么选这个、和哪个句型容易混、在哪见过…"
                  />
                  <div className="flex items-center gap-2">
                    <Button size="sm" type="button"
                      onPress={() => void saveNote()}
                      isDisabled={isSavingNote}
                    >
                      {isSavingNote ? '保存中…' : '保存'}
                    </Button>
                    <Button variant="outline" size="sm" type="button"
                      onPress={() => setIsEditingNote(false)}
                      isDisabled={isSavingNote}
                    >
                      取消
                    </Button>
                    {noteError ? (
                      <span className="text-danger">{noteError}</span>
                    ) : null}
                  </div>
                </div>
              ) : note ? (
                <div className="grid gap-1.5">
                  <p className="m-0 whitespace-pre-wrap [overflow-wrap:anywhere]">
                    {note}
                  </p>
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm"
                      className="h-auto min-h-0 px-1 underline"
                      type="button" onPress={openNoteEditor}
                    >
                      编辑
                    </Button>
                  </div>
                </div>
              ) : (
                <Button variant="ghost" size="sm"
                  className="h-auto min-h-0 px-1 underline"
                  type="button" onPress={openNoteEditor}
                >
                  写点什么
                </Button>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
