import { useEffect, useState } from 'react'
import { Button, Card, Chip, Spinner, toast } from '@heroui/react'
import { Link, useNavigate } from 'react-router'

import {
  getExamPapers,
  resetExam,
  startExam,
  type ExamPaper,
  type ExamPhase,
} from '../../api/qbankExam'
import { getErrorMessage } from '../../api/error'
import { confirm } from '../../components/ui/dialog'
import { useOnPageReactivated } from '../../components/layout/pageContext'
import { useExamSettings } from '../../store/examSettings'
import { examModeLabel, paperLabel } from './constants'
import { ROW, ROW_LABEL, ROW_LINK, ROW_MAIN, ROW_TITLE } from './styles'

/**
 * 模拟考试的卷子列表：历年历次各一行，开考 / 继续 / 看成绩 / 重置。
 *
 * 一套卷同时只有一份考试记录，「重置」就是把它删掉重来 —— 所以重置要弹确认。
 */

const PHASE_TEXT: Record<ExamPhase, string> = {
  written: '笔试进行中',
  listening: '听力进行中',
  done: '已完成',
}

export function ExamPaperList() {
  const navigate = useNavigate()
  const mode = useExamSettings((s) => s.mode)
  const [papers, setPapers] = useState<ExamPaper[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = () =>
    getExamPapers()
      .then(setPapers)
      .catch((e) => toast.danger(getErrorMessage(e, '加载考试列表失败')))

  useEffect(() => {
    void load()
  }, [])

  // JLPT 页是 keep-alive 的，考完试回来这份列表还是旧的，重新对一次分数和进度。
  useOnPageReactivated(() => void load())

  const examHref = (paper: ExamPaper) => `/jlpt/exams/${paper.year}/${paper.month}`

  const start = async (paper: ExamPaper) => {
    const key = `${paper.year}-${paper.month}`
    setBusy(key)
    try {
      await startExam(paper.year, paper.month, mode)
      navigate(examHref(paper))
    } catch (e) {
      toast.danger(getErrorMessage(e, '开考失败'))
    } finally {
      setBusy(null)
    }
  }

  const reset = async (paper: ExamPaper) => {
    const ok = await confirm({
      title: `重置 ${paperLabel(paper.year, paper.month)}？`,
      content: '这套卷子的作答和成绩会被清空，可以重新开考。已收进错题本的题不受影响。',
      okText: '重置',
      cancelText: '取消',
      status: 'warning',
    })
    if (!ok) return
    const key = `${paper.year}-${paper.month}`
    setBusy(key)
    try {
      await resetExam(paper.year, paper.month)
      setPapers((prev) =>
        (prev ?? []).map((p) =>
          p.year === paper.year && p.month === paper.month ? { ...p, attempt: null } : p,
        ),
      )
      toast.success('已重置')
    } catch (e) {
      toast.danger(getErrorMessage(e, '重置失败'))
    } finally {
      setBusy(null)
    }
  }

  if (!papers) {
    return (
      <div className="grid place-items-center py-12">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="grid gap-3">
      <p className="muted m-0 text-[13px]">
        整卷计时开考：笔试（文字・語彙 / 文法 / 読解）限时 110 分，交卷后才能进听力，听力整段连着播完。
        当前考试模式 <b className="text-foreground">{examModeLabel(mode)}</b>，
        <Link className="text-accent underline-offset-2 hover:underline" to="/settings">
          去设置里改
        </Link>
        。
      </p>

      <ul className="m-0 grid list-none gap-2 p-0">
        {papers.map((paper) => {
          const key = `${paper.year}-${paper.month}`
          const attempt = paper.attempt
          const isBusy = busy === key
          return (
            <Card<'li'>
              className="gap-0 overflow-hidden p-0"
              key={key}
              render={(props) => <li {...props} />}
            >
              <div className={ROW}>
                <span className={ROW_LABEL}>{paperLabel(paper.year, paper.month)}</span>
                <div className={ROW_MAIN}>
                  <p className={ROW_TITLE}>新日本語能力試験 N1</p>
                  <p className="muted mt-0.5 mb-0 text-xs tabular-nums">
                    共 {paper.writtenTotal + paper.listeningTotal} 题 · 笔试 {paper.writtenTotal} ·
                    听力 {paper.listeningTotal}
                    {attempt ? ` · ${PHASE_TEXT[attempt.phase]}` : ''}
                    {attempt && attempt.phase !== 'done' ? ` · 已答 ${attempt.answered}` : ''}
                  </p>
                </div>

                {attempt?.score ? (
                  <Chip color={attempt.score.passed ? 'success' : 'danger'} variant="soft">
                    估算 {attempt.score.points} / 180
                  </Chip>
                ) : attempt ? (
                  <Chip color="warning" variant="soft">
                    {examModeLabel(attempt.mode)}模式
                  </Chip>
                ) : null}

                {attempt ? (
                  <Link className={ROW_LINK} to={examHref(paper)}>
                    {attempt.phase === 'done' ? '查看成绩' : '继续考试'}
                  </Link>
                ) : (
                  <Button
                    className="shrink-0"
                    isPending={isBusy}
                    size="sm"
                    onPress={() => void start(paper)}
                  >
                    开始考试
                  </Button>
                )}
                <Button
                  className="shrink-0"
                  isDisabled={!attempt || isBusy}
                  size="sm"
                  variant="ghost"
                  onPress={() => void reset(paper)}
                >
                  重置
                </Button>
              </div>
            </Card>
          )
        })}
      </ul>
    </div>
  )
}
