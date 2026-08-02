import { useEffect, useState } from 'react'
import { Button, toast } from '@heroui/react'
import { Link, useNavigate, useParams } from 'react-router'
import {
  deleteAttempt,
  getExam,
  listAttempts,
  startAttempt,
  type ExamAttempt,
} from '../api/exams'
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

function formatDateTime(iso: string) {
  const d = new Date(iso)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${y}-${m}-${day} ${hh}:${mm}`
}

function QuestionCard({ q }: { q: ExamQuestion }) {
  return (
    <ExamQuestionCard id={q.id} stem={q.stem} target={q.target}>
      <ExamChoiceList>
        {q.choices.map((c, idx) => (
          <ExamChoice key={idx} num={idx + 1}>
            <span>{c}</span>
          </ExamChoice>
        ))}
      </ExamChoiceList>
    </ExamQuestionCard>
  )
}

function SectionBlock({ section }: { section: ExamSection }) {
  return (
    <ExamSectionBlock
      label={SECTION_LABELS[section.type] ?? section.type}
      instruction={section.instruction}
      passage={section.passage}
    >
      {section.questions.map((q) => (
        <QuestionCard key={q.id} q={q} />
      ))}
    </ExamSectionBlock>
  )
}

export function ExamDetailPage() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const [exam, setExam] = useState<ExamDetail | null>(null)
  const [attempts, setAttempts] = useState<ExamAttempt[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isStarting, setIsStarting] = useState(false)

  useEffect(() => {
    if (!id) return
    setIsLoading(true)
    Promise.all([getExam(id), listAttempts(id)])
      .then(([exRow, attemptRows]) => {
        setExam(exRow)
        setAttempts(attemptRows)
      })
      .catch((e) => toast.danger(getErrorMessage(e, '加载真题失败')))
      .finally(() => setIsLoading(false))
  }, [id])

  const handleStart = async () => {
    if (!id) return
    setIsStarting(true)
    try {
      const attempt = await startAttempt(id)
      navigate(`/exams/${id}/attempts/${attempt.id}`)
    } catch (err) {
      toast.danger(getErrorMessage(err, '无法开始考试'))
    } finally {
      setIsStarting(false)
    }
  }

  const handleResume = (attempt: ExamAttempt) => {
    if (!id) return
    navigate(`/exams/${id}/attempts/${attempt.id}`)
  }

  const handleDeleteAttempt = async (attempt: ExamAttempt) => {
    if (!id) return
    if (!window.confirm('删除这次考试记录?')) return
    try {
      await deleteAttempt(id, attempt.id)
      setAttempts((prev) => prev.filter((a) => a.id !== attempt.id))
    } catch (err) {
      toast.danger(getErrorMessage(err, '删除失败'))
    }
  }

  if (!id) return null

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
          <p className="muted">未找到这份真题。</p>
          <Link className="button button--primary" to="/exams">
            回真题列表
          </Link>
        </div>
      </section>
    )
  }

  const sections = exam.parsedData?.sections ?? []
  const totalQuestions = sections.reduce((s, sec) => s + sec.questions.length, 0)
  const questionsWithAnswer = sections.reduce(
    (s, sec) => s + sec.questions.filter((q) => q.answer !== null).length,
    0,
  )
  const inProgress = attempts.find((a) => !a.finishedAt) ?? null

  return (
    <section className="page exam-detail">
      <div className="section-header">
        <div>
          <h2>
            {exam.title}
            <span className="folder-language tag-inline">{exam.level}</span>
          </h2>
          <p className="muted">
            {exam.year ? `${exam.year} · ` : ''}
            {sections.length} 个部分 · 共 {totalQuestions} 题 · 有答案 {questionsWithAnswer} 题
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {inProgress ? (
            <Button
              type="button"
              onPress={() => handleResume(inProgress)}
              isDisabled={isStarting}
            >
              继续上次考试
            </Button>
          ) : (
            <Button
              type="button"
              onPress={() => void handleStart()}
              isDisabled={isStarting || questionsWithAnswer === 0}
              render={(props) => <button {...props} title={
                questionsWithAnswer === 0
                  ? '还没有答案数据 —— 上传解析 PDF 才能开考'
                  : ''
              } />}
            >
              {isStarting ? '准备中…' : '开始考试'}
            </Button>
          )}
        </div>
      </div>

      {attempts.length > 0 ? (
        <div className="card mt-5 p-4">
          <h3 className="mt-0 mb-3 text-[15px] text-muted">历次记录</h3>
          <ul className="m-0 grid list-none gap-2 p-0">
            {attempts.map((a) => (
              <li key={a.id} className="flex items-center gap-3 rounded-lg bg-foreground/3 px-3 py-2.5">
                <div className="min-w-0 flex-1 text-sm [&>strong]:text-foreground">
                  <strong>
                    {a.finishedAt ? `${a.score ?? 0} 分` : '进行中'}
                  </strong>
                  <span className="muted">
                    {' '}
                    · 开始 {formatDateTime(a.startedAt)}
                    {a.finishedAt ? ` · 交卷 ${formatDateTime(a.finishedAt)}` : ''}
                  </span>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  {a.finishedAt ? (
                    <Link
                      className="button button--outline button--sm"
                      to={`/exams/${id}/attempts/${a.id}/result`}
                    >
                      查看结果
                    </Link>
                  ) : (
                    <Button variant="outline" size="sm"
                      type="button"
                      onPress={() => handleResume(a)}
                    >
                      继续
                    </Button>
                  )}
                  <Button variant="outline" size="sm"
                    type="button"
                    onPress={() => void handleDeleteAttempt(a)}
                  >
                    删除
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {sections.length === 0 ? (
        <div className="card state-card">
          <p className="muted">这份真题解析结果为空,可能是 PDF 结构异常。</p>
        </div>
      ) : (
        <div className="exam-detail-body">
          {sections.map((sec, i) => (
            <SectionBlock key={i} section={sec} />
          ))}
        </div>
      )}
    </section>
  )
}
