import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { message } from 'antd'
import { getAttempt, getExam, type ExamAttempt } from '../api/exams'
import { getErrorMessage } from '../api/error'
import type {
  ExamDetail,
  ExamQuestion,
  ExamSection,
  ExamSectionType,
} from '../types'

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
    <li
      className={
        'exam-question-card' +
        (isCorrect ? ' is-correct' : '') +
        (isWrong ? ' is-wrong' : '') +
        (notAttempted ? ' is-skipped' : '')
      }
    >
      <div className="exam-question-head">
        <span className="exam-question-id">{q.id}</span>
        <div className="exam-question-stem">
          {q.target ? (
            <p className="exam-question-target">目标词:{q.target}</p>
          ) : null}
          <p>{q.stem}</p>
        </div>
        <span className="exam-question-badge">
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
      </div>
      <ol className="exam-question-choices">
        {q.choices.map((c, idx) => {
          const num = idx + 1
          const isAnswer = correct === num
          const isPicked = userAnswer === num
          const cls =
            'exam-question-choice' +
            (isAnswer ? ' is-answer' : '') +
            (isPicked && !isAnswer ? ' is-picked-wrong' : '') +
            (isPicked && isAnswer ? ' is-picked-correct' : '')
          return (
            <li key={idx} className={cls}>
              <span className="exam-question-choice-num">{num}</span>
              <span>{c}</span>
              {isAnswer ? <span className="exam-question-tag">正确答案</span> : null}
              {isPicked && !isAnswer ? (
                <span className="exam-question-tag">你的选择</span>
              ) : null}
            </li>
          )
        })}
      </ol>
      {q.explanation ? (
        <p className="exam-question-explanation">{q.explanation}</p>
      ) : null}
    </li>
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
    <section className="exam-section">
      <header className="exam-section-header">
        <p className="eyebrow">{SECTION_LABELS[section.type] ?? section.type}</p>
        <p className="exam-section-instruction">{section.instruction}</p>
      </header>
      {section.passage ? (
        <div className="exam-section-passage">
          <p>{section.passage}</p>
        </div>
      ) : null}
      <ol className="exam-question-list">
        {section.questions.map((q) => (
          <ResultQuestion
            key={q.id}
            q={q}
            userAnswer={answers[String(q.id)]}
          />
        ))}
      </ol>
    </section>
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
      .catch((e) => message.error(getErrorMessage(e, '加载结果失败')))
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
          <Link className="primary-link" to="/exams">
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
          <p className="eyebrow">
            <Link to={`/exams/${id}`}>← 返回真题</Link>
          </p>
          <h2>{exam.title} · 成绩</h2>
          <p className="muted">
            {formatDateTime(attempt.startedAt)} → {formatDateTime(attempt.finishedAt)}
          </p>
        </div>
      </div>

      <div className="card exam-score-card">
        <div className="exam-score-headline">
          <span className="exam-score-num">{attempt.score ?? 0}</span>
          <span className="muted">分 · 正确 {totalCorrect} / {totalGraded}</span>
        </div>
        {Object.keys(scoreByType).length > 0 ? (
          <ul className="exam-score-breakdown">
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
