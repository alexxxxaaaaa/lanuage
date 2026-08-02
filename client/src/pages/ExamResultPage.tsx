import { useEffect, useState } from 'react'
import { toast } from '@heroui/react'
import { Link, useParams } from 'react-router'
import { getAttempt, getExam, type ExamAttempt } from '../api/exams'
import { getErrorMessage } from '../api/error'
import type {
  ExamDetail,
  ExamQuestion,
  ExamSection,
  ExamSectionType,
} from '../types'
import {
  ExamChoice,
  ExamChoiceList,
  ExamQuestionCard,
  ExamSectionBlock,
} from '../components/exam/ExamQuestion'

// 选项行尾的小标签（正确答案 / 你的选择）。
const TAG = 'ml-2 rounded bg-foreground/8 px-1.5 py-0.5 text-[11px] text-muted'

const SECTION_LABELS: Record<ExamSectionType, string> = {
  vocabulary_reading: '文字·語彙 · 汉字读音',
  vocabulary_kanji: '文字·語彙 · 汉字写法',
  vocabulary_context: '文字·語彙 · 文脉规定',
  vocabulary_paraphrase: '文字·語彙 · 近义替换',
  vocabulary_usage: '文字·語彙 · 用法',
  grammar_choose: '文法 · 选择',
  grammar_arrange: '文法 · 排序',
  reading_comprehension: '読解',
  listening: '聴解',
  other: '其他',
}

function formatDateTime(iso: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${y}-${m}-${day} ${hh}:${mm}`
}

function ResultQuestion({
  q,
  userAnswer,
}: {
  q: ExamQuestion
  userAnswer: number | undefined
}) {
  const correct = q.answer
  const answered = userAnswer !== undefined
  const isCorrect = correct !== null && userAnswer === correct
  const isWrong = correct !== null && answered && userAnswer !== correct
  const notAttempted = !answered
  const answerUnknown = answered && correct === null
  return (
    <ExamQuestionCard
      id={q.id}
      stem={q.stem}
      target={q.target}
      tone={isCorrect ? 'correct' : isWrong ? 'wrong' : notAttempted ? 'skipped' : 'default'}
      badge={
        <span
          className={`ml-auto self-start rounded-full px-2 py-0.5 text-xs ${
            isCorrect
              ? 'bg-success/16 text-green-700'
              : isWrong
                ? 'bg-danger/16 text-red-800'
                : 'bg-foreground/6 text-foreground'
          }`}
        >
          {isCorrect
            ? '✓ 正确'
            : isWrong
              ? '✗ 错误'
              : notAttempted
                ? '— 未答'
                : answerUnknown
                  ? '· 无答案数据'
                  : ''}
        </span>
      }
    >
      <ExamChoiceList>
        {q.choices.map((c, idx) => {
          const num = idx + 1
          const isAnswer = correct === num
          const isPicked = userAnswer === num
          return (
            <ExamChoice
              key={idx}
              num={num}
              tone={
                isPicked && isAnswer
                  ? 'pickedCorrect'
                  : isAnswer
                    ? 'answer'
                    : isPicked
                      ? 'pickedWrong'
                      : 'default'
              }
            >
              <span>{c}</span>
              {isAnswer ? <span className={TAG}>正确答案</span> : null}
              {isPicked && !isAnswer ? <span className={TAG}>你的选择</span> : null}
            </ExamChoice>
          )
        })}
      </ExamChoiceList>
      {q.explanation ? (
        <p className="mt-3 mr-0 mb-0 ml-[38px] rounded-md border-l-[3px] border-indigo-500/40 bg-indigo-500/6 px-3 py-2.5 text-[13px]/[1.7] whitespace-pre-wrap text-foreground">
          {q.explanation}
        </p>
      ) : null}
    </ExamQuestionCard>
  )
}

function ResultSection({
  section,
  answers,
}: {
  section: ExamSection
  answers: Record<string, number>
}) {
  return (
    <ExamSectionBlock
      label={SECTION_LABELS[section.type] ?? section.type}
      instruction={section.instruction}
      passage={section.passage}
    >
      {section.questions.map((q) => (
        <ResultQuestion key={q.id} q={q} userAnswer={answers[String(q.id)]} />
      ))}
    </ExamSectionBlock>
  )
}

export function ExamResultPage() {
  const { id, attemptId } = useParams<{ id: string; attemptId: string }>()
  const [exam, setExam] = useState<ExamDetail | null>(null)
  const [attempt, setAttempt] = useState<ExamAttempt | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    if (!id || !attemptId) return
    setIsLoading(true)
    Promise.all([getExam(id), getAttempt(id, attemptId)])
      .then(([exRow, attRow]) => {
        setExam(exRow)
        setAttempt(attRow)
      })
      .catch((e) => toast.danger(getErrorMessage(e, '加载结果失败')))
      .finally(() => setIsLoading(false))
  }, [id, attemptId])

  if (!id || !attemptId) return null
  if (isLoading) {
    return (
      <section className="page">
        <div className="card state-card">
          <p className="muted">加载中…</p>
        </div>
      </section>
    )
  }
  if (!exam || !attempt) {
    return (
      <section className="page">
        <div className="card state-card">
          <p className="muted">未找到考试记录。</p>
          <Link className="button button--primary" to="/exams">
            回真题列表
          </Link>
        </div>
      </section>
    )
  }

  const answers = (() => {
    try {
      return JSON.parse(attempt.answers || '{}') as Record<string, number>
    } catch {
      return {}
    }
  })()
  const scoreByType = (() => {
    try {
      return JSON.parse(attempt.scoreByType || '{}') as Record<
        string,
        { correct: number; total: number }
      >
    } catch {
      return {}
    }
  })()

  const sections = exam.parsedData?.sections ?? []
  const totalCorrect = Object.values(scoreByType).reduce(
    (s, v) => s + (v?.correct ?? 0),
    0,
  )
  const totalGraded = Object.values(scoreByType).reduce(
    (s, v) => s + (v?.total ?? 0),
    0,
  )

  return (
    <section className="page exam-detail">
      <div className="section-header">
        <div>
          <h2>{exam.title} · 成绩</h2>
          <p className="muted">
            {formatDateTime(attempt.startedAt)} → {formatDateTime(attempt.finishedAt)}
          </p>
        </div>
      </div>

      <div className="card my-5 grid gap-4 p-5">
        <div className="flex items-baseline gap-3">
          <span className="text-5xl leading-none font-bold text-indigo-600">{attempt.score ?? 0}</span>
          <span className="muted">分 · 正确 {totalCorrect} / {totalGraded}</span>
        </div>
        {Object.keys(scoreByType).length > 0 ? (
          <ul className="m-0 grid list-none gap-1.5 p-0 [&>li]:flex [&>li]:justify-between [&>li]:rounded-md [&>li]:bg-foreground/3 [&>li]:px-2.5 [&>li]:py-1.5 [&>li]:text-sm">
            {Object.entries(scoreByType).map(([type, v]) => (
              <li key={type}>
                <span>{SECTION_LABELS[type as ExamSectionType] ?? type}</span>
                <strong>
                  {v.correct} / {v.total}
                </strong>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="exam-detail-body">
        {sections.map((sec, i) => (
          <ResultSection key={i} section={sec} answers={answers} />
        ))}
      </div>
    </section>
  )
}
