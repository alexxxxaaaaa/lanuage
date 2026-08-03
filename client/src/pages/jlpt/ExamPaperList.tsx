import { useEffect, useState } from 'react'
import { Button, EmptyState, Table, Tooltip, toast } from '@heroui/react'
import { RotateCcw } from 'lucide-react'
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
import { useSettings } from '../../store/useSettings'
import { examModeLabel, paperLabel } from './constants'
import {
  ACTION_LINK,
  CELL_ACTIONS,
  CELL_MAIN,
  CELL_SUB,
  TABLE_DENSE,
} from './styles'

/**
 * 模拟考试的卷子列表：历年历次各一行，开考 / 继续 / 看成绩 / 重置。
 *
 * 一套卷同时只有一份考试记录，「重置」就是把它删掉重来 —— 所以重置要弹确认。
 */

const PHASE_TEXT: Record<ExamPhase, string> = {
  written: '笔试中',
  listening: '听力中',
  done: '已完成',
}

export function ExamPaperList() {
  const navigate = useNavigate()
  const mode = useSettings((s) => s.settings.examMode)
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

      <Table>
        <Table.ScrollContainer>
          <Table.Content aria-label="模拟考试卷次" className={TABLE_DENSE}>
            <Table.Header>
              <Table.Column isRowHeader>卷次</Table.Column>
              <Table.Column>进度</Table.Column>
              <Table.Column className="text-end">操作</Table.Column>
            </Table.Header>
            <Table.Body
              renderEmptyState={() => (
                <EmptyState className="py-10 text-center text-sm text-muted">
                  {papers ? '题库还没导入。' : '加载中…'}
                </EmptyState>
              )}
            >
              {(papers ?? []).map((paper) => {
                const key = `${paper.year}-${paper.month}`
                const attempt = paper.attempt
                const isBusy = busy === key
                return (
                  <Table.Row id={key} key={key} textValue={paperLabel(paper.year, paper.month)}>
                    <Table.Cell>
                      <div className={CELL_MAIN}>{paperLabel(paper.year, paper.month)}</div>
                      <div className={CELL_SUB}>
                        {paper.writtenTotal + paper.listeningTotal} 题
                      </div>
                    </Table.Cell>

                    {/* 状态和它的那个数字叠成两行：进行中看已答多少，考完看估算分。 */}
                    <Table.Cell>
                      {attempt ? (
                        <>
                          <div className={CELL_MAIN}>{PHASE_TEXT[attempt.phase]}</div>
                          {attempt.score ? (
                            // 着色只落在得分那个数上：满分是常量，染了也没多告诉一句。
                            <div className={CELL_SUB}>
                              <span
                                className={
                                  attempt.score.passed ? 'text-success' : 'text-danger'
                                }
                              >
                                {attempt.score.points}
                              </span>{' '}
                              / 180
                            </div>
                          ) : (
                            <div className={CELL_SUB}>已答 {attempt.answered}</div>
                          )}
                        </>
                      ) : (
                        <span className="text-muted">未开始</span>
                      )}
                    </Table.Cell>

                    <Table.Cell>
                      <div className={CELL_ACTIONS}>
                        {attempt ? (
                          <Link className={ACTION_LINK} to={examHref(paper)}>
                            {attempt.phase === 'done' ? '看成绩' : '继续'}
                          </Link>
                        ) : (
                          <Button
                            isPending={isBusy}
                            size="sm"
                            onPress={() => void start(paper)}
                          >
                            开始考试
                          </Button>
                        )}
                        {/* 没考过就没得重置 —— 与其摆一个永远灰着的按钮，不如不占这一格。 */}
                        {attempt ? (
                          <Tooltip delay={300}>
                            <Button
                              isIconOnly
                              aria-label="重置这套卷"
                              isDisabled={isBusy}
                              size="sm"
                              variant="ghost"
                              onPress={() => void reset(paper)}
                            >
                              <RotateCcw className="size-4" aria-hidden />
                            </Button>
                            <Tooltip.Content>重置这套卷</Tooltip.Content>
                          </Tooltip>
                        ) : null}
                      </div>
                    </Table.Cell>
                  </Table.Row>
                )
              })}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>
    </div>
  )
}
