import type { ReactNode } from 'react'

// The three exam pages (detail / take / result) render the same question
// markup with different affordances: detail is read-only, take makes the
// choices clickable, result paints the graded state. They used to each spell
// the markup out and share it through `exam-question-*` classes in App.css —
// these components are that shared layer, now colocated with the styling.

type CardTone = 'default' | 'correct' | 'wrong' | 'skipped'

const CARD_BORDER: Record<CardTone, string> = {
  default: 'border-foreground/8',
  correct: 'border-green-500/50',
  wrong: 'border-red-500/50',
  skipped: 'border-foreground/20',
}

export function ExamQuestionCard({
  id,
  stem,
  target,
  tone = 'default',
  preserveLineBreaks = false,
  badge,
  children,
}: {
  id: string | number
  stem: string
  target?: string | null
  tone?: CardTone
  /** Take/result stems carry the original paper's line breaks. */
  preserveLineBreaks?: boolean
  /** Right-aligned status pill, only used by the result page. */
  badge?: ReactNode
  /** Choice list, plus anything the page appends (tags, explanation). */
  children: ReactNode
}) {
  return (
    <li className={`rounded-[10px] border bg-white px-3.5 py-3 ${CARD_BORDER[tone]}`}>
      <div className="flex items-start gap-2.5">
        <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-indigo-500/12 text-[13px] font-semibold text-indigo-600">
          {id}
        </span>
        <div className="min-w-0 flex-1 text-[15px]/[1.7] text-foreground [&>p]:m-0">
          {target ? (
            <p className="mb-1 text-xs font-medium text-indigo-600">目标词:{target}</p>
          ) : null}
          <p className={preserveLineBreaks ? 'whitespace-pre-wrap' : undefined}>{stem}</p>
        </div>
        {badge}
      </div>
      {children}
    </li>
  )
}

/** Indented to line up under the stem, clearing the 28px number badge. */
export function ExamChoiceList({ children }: { children: ReactNode }) {
  return <ol className="m-0 mt-2.5 ml-[38px] grid list-none gap-1.5 p-0">{children}</ol>
}

type ChoiceTone = 'default' | 'picked' | 'answer' | 'pickedCorrect' | 'pickedWrong'

const CHOICE: Record<ChoiceTone, string> = {
  default: 'bg-foreground/3',
  picked: 'border-indigo-500 bg-indigo-500/16',
  answer: 'bg-green-500/14',
  pickedCorrect: 'bg-green-500/24',
  pickedWrong: 'bg-red-500/12',
}

const CHOICE_NUM: Record<ChoiceTone, string> = {
  default: 'border-foreground/18 bg-white',
  picked: 'border-indigo-500 bg-indigo-500 text-white',
  answer: 'border-green-500 bg-green-500 text-white',
  pickedCorrect: 'border-green-500 bg-green-500 text-white',
  pickedWrong: 'border-red-500 bg-red-500 text-white',
}

export function ExamChoice({
  num,
  tone = 'default',
  onSelect,
  children,
}: {
  num: number
  tone?: ChoiceTone
  /** Present only on the take page; makes the row a click target. */
  onSelect?: () => void
  children: ReactNode
}) {
  return (
    <li
      className={`flex items-baseline gap-2.5 rounded-md border border-transparent px-2.5 py-1.5 text-sm text-foreground ${
        CHOICE[tone]
      } ${
        onSelect
          ? 'cursor-pointer transition-[background-color,border-color] duration-150 hover:bg-indigo-500/8'
          : ''
      }`}
      onClick={onSelect}
    >
      <span
        className={`inline-flex size-[22px] shrink-0 items-center justify-center rounded-full border text-xs ${CHOICE_NUM[tone]}`}
      >
        {num}
      </span>
      {children}
    </li>
  )
}

export function ExamSectionBlock({
  label,
  instruction,
  passage,
  isListening = false,
  children,
}: {
  label: string
  instruction?: string
  passage?: string | null
  isListening?: boolean
  children: ReactNode
}) {
  return (
    <section className="grid gap-3">
      <header
        className={`grid gap-1 rounded-[10px] px-3.5 py-3 ${
          isListening ? 'bg-amber-500/10' : 'bg-indigo-500/8'
        }`}
      >
        <p
          className={`m-0 text-xs tracking-[0.5px] ${
            isListening ? 'eyebrow text-amber-700' : 'eyebrow text-indigo-600'
          }`}
        >
          {label}
        </p>
        {instruction ? (
          <p className="m-0 text-sm/[1.6] text-foreground">{instruction}</p>
        ) : null}
      </header>
      {passage ? (
        <div className="rounded-md border-l-[3px] border-indigo-500/40 bg-foreground/2 px-4 py-3.5 text-sm/[1.8] whitespace-pre-wrap text-foreground">
          <p>{passage}</p>
        </div>
      ) : null}
      <ol className="m-0 grid list-none gap-2.5 p-0">{children}</ol>
    </section>
  )
}
