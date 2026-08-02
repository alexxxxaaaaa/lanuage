import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, toast } from '@heroui/react'
import { confirm } from '../components/ui/dialog'
import { Link, useNavigate, useParams } from 'react-router'
import {
  getAttempt,
  getExam,
  patchAttempt,
  submitAttempt,
} from '../api/exams'
import { getErrorMessage } from '../api/error'
import { ExamAudioPlayer } from '../components/ExamAudioPlayer'
import type { ExamDetail, ExamQuestion, ExamSection } from '../types'
import {
  ExamChoice,
  ExamChoiceList,
  ExamQuestionCard,
  ExamSectionBlock,
} from '../components/exam/ExamQuestion'

// N1 real-exam durations. Reading portion covers vocab + grammar + reading;
// listening is a separate 60-min block. Both count down from startedAt but we
// treat the listening timer as beginning when the user reaches it (opt-in).
const READING_MINUTES = 110
const LISTENING_MINUTES = 60
const AUTO_SAVE_INTERVAL_MS = 10_000

function formatCountdown(ms: number): string {
  if (ms <= 0) return '00:00'
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** Flatten sections in order, tagging each question with its parent section
 *  so the take-page can render questions inline with their section headers
 *  but still index them all by a single flat array for progress + jump. */
type FlatQuestion = {
  section: ExamSection
  sectionIdx: number
  question: ExamQuestion
}

function flattenSections(sections: ExamSection[]): FlatQuestion[] {
  const flat: FlatQuestion[] = []
  sections.forEach((section, sectionIdx) => {
    for (const q of section.questions) {
      flat.push({ section, sectionIdx, question: q })
    }
  })
  return flat
}

export function ExamTakePage() {
  const navigate = useNavigate()
  const { id, attemptId } = useParams<{ id: string; attemptId: string }>()
  const [exam, setExam] = useState<ExamDetail | null>(null)
  const [answers, setAnswers] = useState<Record<string, number>>({})
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [now, setNow] = useState(Date.now())
  // Track whether the user has been notified the reading timer ran out — we
  // don't force-submit at zero (users may not have started the listening
  // portion yet), just show the timer in red.
  const answersRef = useRef(answers)
  answersRef.current = answers

  useEffect(() => {
    if (!id || !attemptId) return
    setIsLoading(true)
    Promise.all([getExam(id), getAttempt(id, attemptId)])
      .then(([exRow, attRow]) => {
        setExam(exRow)
        try {
          setAnswers(JSON.parse(attRow.answers || '{}') as Record<string, number>)
        } catch {
          setAnswers({})
        }
        setStartedAt(new Date(attRow.startedAt).getTime())
        if (attRow.finishedAt) {
          // Already finalized; bounce to result page.
          navigate(`/exams/${id}/attempts/${attemptId}/result`, { replace: true })
        }
      })
      .catch((e) => toast.danger(getErrorMessage(e, '加载考试失败')))
      .finally(() => setIsLoading(false))
  }, [id, attemptId, navigate])

  // 1-second tick for the countdown display. Cheap — we're comparing to
  // `startedAt` fetched once from the server, so nothing recomputes but the
  // rendered clock string.
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [])

  // Autosave: every N seconds if we have a dirty state. We debounce by only
  // sending if answers changed since last save (tracked via ref of last-sent).
  const lastSentRef = useRef<string>('{}')
  useEffect(() => {
    if (!id || !attemptId) return
    const t = window.setInterval(() => {
      const serialized = JSON.stringify(answersRef.current)
      if (serialized === lastSentRef.current) return
      lastSentRef.current = serialized
      void patchAttempt(id, attemptId, answersRef.current).catch(() => {
        // best-effort; try again next tick
        lastSentRef.current = '__failed__'
      })
    }, AUTO_SAVE_INTERVAL_MS)
    return () => window.clearInterval(t)
  }, [id, attemptId])

  // Fire a final save via keepalive fetch on page unload / tab close.
  useEffect(() => {
    const handler = () => {
      if (!id || !attemptId) return
      const serialized = JSON.stringify(answersRef.current)
      if (serialized === lastSentRef.current) return
      // Best-effort keepalive; axios doesn't do keepalive so use fetch.
      const base = import.meta.env.VITE_API_BASE_URL ?? ''
      const token = window.localStorage.getItem('word-sprint-token') ?? ''
      try {
        void fetch(`${base}/api/exams/${id}/attempts/${attemptId}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ answers: answersRef.current }),
          keepalive: true,
        })
      } catch {
        // ignore — we're leaving anyway
      }
    }
    window.addEventListener('pagehide', handler)
    window.addEventListener('beforeunload', handler)
    return () => {
      window.removeEventListener('pagehide', handler)
      window.removeEventListener('beforeunload', handler)
    }
  }, [id, attemptId])

  const sections = exam?.parsedData?.sections ?? []
  const flat = useMemo(() => flattenSections(sections), [sections])

  const listeningStartIdx = useMemo(
    () => flat.findIndex((f) => f.section.type === 'listening'),
    [flat],
  )
  const hasListening = listeningStartIdx >= 0
  const readingCount =
    listeningStartIdx >= 0 ? listeningStartIdx : flat.length
  const listeningCount = hasListening ? flat.length - listeningStartIdx : 0

  // Timer math. We keep a SINGLE 170-min budget bounded by (reading +
  // listening) — the server just stores startedAt, and elapsed = now - startedAt.
  // Displayed countdown flips to the listening budget once the user actually
  // scrolls into the listening section (heuristic: their latest answer is in
  // a listening question).
  const isInListeningPhase = useMemo(() => {
    if (!hasListening) return false
    // If any listening question is answered, treat as in listening phase.
    for (let i = listeningStartIdx; i < flat.length; i++) {
      if (answers[String(flat[i].question.id)] !== undefined) return true
    }
    return false
  }, [answers, flat, hasListening, listeningStartIdx])

  const elapsedMs = startedAt !== null ? now - startedAt : 0
  const readingMs = READING_MINUTES * 60_000
  const listeningMs = LISTENING_MINUTES * 60_000
  const remaining = isInListeningPhase
    ? readingMs + listeningMs - elapsedMs
    : readingMs - elapsedMs

  const answeredCount = Object.keys(answers).length

  const pickChoice = (qId: number, choice: number) => {
    setAnswers((prev) => ({ ...prev, [String(qId)]: choice }))
  }

  const handleSubmit = async () => {
    if (!id || !attemptId) return
    const unanswered = flat.length - answeredCount
    if (unanswered > 0) {
      const ok = await confirm({
        title: '还有未作答的题',
        content: `你还有 ${unanswered} 题没做,确定交卷吗?`,
        okText: '仍然交卷',
        cancelText: '继续答题',
        status: 'warning',
      })
      if (!ok) return
    }
    setIsSubmitting(true)
    try {
      await submitAttempt(id, attemptId, answers)
      navigate(`/exams/${id}/attempts/${attemptId}/result`, { replace: true })
    } catch (err) {
      toast.danger(getErrorMessage(err, '交卷失败'))
      setIsSubmitting(false)
    }
  }

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

  if (!exam) {
    return (
      <section className="page">
        <div className="card state-card">
          <p className="muted">未找到这份考试。</p>
          <Link className="button button--primary" to="/exams">
            回列表
          </Link>
        </div>
      </section>
    )
  }

  const isOvertime = remaining <= 0

  // Subtitle URL lives inside parsedData.meta so we don't have to change the
  // DB schema — falls back to undefined when the exam has no companion SRT.
  const subtitleUrl =
    exam.parsedData?.meta?.subtitleUrl || (exam as ExamDetail).subtitleUrl

  return (
    <section className="page">
      <header className="sticky top-0 z-10 mb-4 flex items-center justify-between gap-4 rounded-xl border border-foreground/6 bg-white/95 px-4 py-3 backdrop-blur-lg">
        <div className="[&>h2]:my-1 [&>h2]:text-lg">
          <p className="eyebrow">
            <Link to={`/exams/${id}`}>← 返回详情</Link>
          </p>
          <h2>{exam.title}</h2>
          <p className="muted">
            {isInListeningPhase ? '聴解 阶段' : '语言知识 · 読解 阶段'} · 已作答 {answeredCount} / {flat.length}
          </p>
        </div>
        <div
          className={`min-w-[130px] rounded-[10px] px-3.5 py-1.5 text-center font-mono text-[28px] font-semibold ${
            isOvertime ? 'bg-danger/12 text-red-600' : 'bg-indigo-500/10 text-indigo-600'
          }`}
        >
          {formatCountdown(remaining)}
        </div>
      </header>

      {exam.audioUrl ? (
        <div className="sticky top-0 z-30 mb-2 bg-white pt-3 pb-2 shadow-[0_8px_12px_-8px_rgba(0,0,0,0.15)]">
          <ExamAudioPlayer
            audioUrl={exam.audioUrl}
            subtitleUrl={subtitleUrl}
          />
        </div>
      ) : null}

      <div className="grid gap-7">
        {sections.map((section, sectionIdx) => {
          const isListening = section.type === 'listening'
          return (
            <ExamSectionBlock
              key={sectionIdx}
              label={`問題 ${sectionIdx + 1}`}
              instruction={section.instruction}
              passage={section.passage}
              isListening={isListening}
            >
              {section.questions.map((q, qIdx) => {
                  const picked = answers[String(q.id)]
                  const prev = qIdx > 0 ? section.questions[qIdx - 1] : null
                  // Per-question passage (問題8 style) — only show once above
                  // its first occurrence.
                  const showPassage =
                    q.passage &&
                    (!prev || prev.passage !== q.passage)
                  // Group heading (問題5・3番 質問1/2) — only above first.
                  const showGroup =
                    q.groupTitle &&
                    (!prev || prev.groupTitle !== q.groupTitle)
                  return (
                    <div key={q.id}>
                      {showPassage ? (
                        <div className="mx-0 mt-0 mb-3 rounded border-l-[3px] border-neutral-500 bg-neutral-100 px-4 py-3 font-serif leading-[1.75] [&>p]:m-0">
                          <p style={{ whiteSpace: 'pre-wrap' }}>{q.passage}</p>
                        </div>
                      ) : null}
                      {showGroup ? (
                        <p className="mt-4 mb-2 text-base font-bold text-foreground">{q.groupTitle}</p>
                      ) : null}
                      <ExamQuestionCard
                        id={q.id}
                        stem={q.stem}
                        target={q.target}
                        preserveLineBreaks
                      >
                        <ExamChoiceList>
                          {q.choices.map((c, idx) => {
                            const choiceNum = idx + 1
                            return (
                              <ExamChoice
                                key={idx}
                                num={choiceNum}
                                tone={picked === choiceNum ? 'picked' : 'default'}
                                onSelect={() => pickChoice(q.id, choiceNum)}
                              >
                                <span>{c}</span>
                              </ExamChoice>
                            )
                          })}
                        </ExamChoiceList>
                      </ExamQuestionCard>
                    </div>
                  )
                })}
            </ExamSectionBlock>
          )
        })}
      </div>

      <div className="sticky bottom-3 mt-8 flex items-center justify-between gap-4 rounded-xl border border-foreground/6 bg-white/95 px-4 py-3 shadow-[0_4px_20px_rgba(15,23,42,0.08)] backdrop-blur-lg">
        <div className="muted">
          {isOvertime ? '已超时,请尽快交卷' : `${isInListeningPhase ? '聴解' : '読解+文字'} 剩余 ${formatCountdown(remaining)}`}
          {' · '}
          共 {readingCount} 题读+词+法{hasListening ? ` · ${listeningCount} 题听力` : ''}
        </div>
        <Button
          type="button"
          isDisabled={isSubmitting}
          onPress={() => void handleSubmit()}
        >
          {isSubmitting ? '交卷中…' : '交卷'}
        </Button>
      </div>
    </section>
  )
}
