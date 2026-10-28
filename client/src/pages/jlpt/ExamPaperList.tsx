import { useCallback, useEffect, useState } from 'react'
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
import { paperLabel } from './constants'
import { useI18n } from '../../i18n'
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

export function ExamPaperList() {
  const { t } = useI18n()
  // 阶段名原来是模块级常量，拿不到 t —— 挪进组件里按当前语言取。
  const phaseText: Record<ExamPhase, string> = {
    written: t('jlpt.phase.written'),
    listening: t('jlpt.phase.listening'),
    done: t('jlpt.phase.done'),
  }
  const navigate = useNavigate()
  const mode = useSettings((s) => s.settings.examMode)
  const sectionOrder = useSettings((s) => s.settings.examSectionOrder)
  const [papers, setPapers] = useState<ExamPaper[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  // useCallback 是因为它闭包了 t：不包住的话每次渲染都是新函数，effect 依赖
  // 里挂不住。t 只随界面语言变，所以实际只会在切语言时重建一次。
  const load = useCallback(
    () =>
      getExamPapers()
        .then(setPapers)
        .catch((e) => toast.danger(getErrorMessage(e, t('jlpt.loadPapersFailed')))),
    [t],
  )

  useEffect(() => {
    void load()
  }, [load])

  // JLPT 页是 keep-alive 的，考完试回来这份列表还是旧的，重新对一次分数和进度。
  useOnPageReactivated(() => void load())

  const examHref = (paper: ExamPaper) => `/jlpt/exams/${paper.year}/${paper.month}`

  const start = async (paper: ExamPaper) => {
    const key = `${paper.year}-${paper.month}`
    setBusy(key)
    try {
      await startExam(paper.year, paper.month, mode, sectionOrder)
      navigate(examHref(paper))
    } catch (e) {
      toast.danger(getErrorMessage(e, t('jlpt.startFailed')))
    } finally {
      setBusy(null)
    }
  }

  const reset = async (paper: ExamPaper) => {
    const ok = await confirm({
      title: t('jlpt.resetTitle', { paper: paperLabel(paper.year, paper.month) }),
      content: t('jlpt.resetContent'),
      okText: t('jlpt.reset'),
      cancelText: t('common.cancel'),
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
      toast.success(t('jlpt.resetDone'))
    } catch (e) {
      toast.danger(getErrorMessage(e, t('jlpt.resetFailed')))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="grid gap-3">
      <p className="muted m-0 text-[13px]">
        {t('jlpt.examIntro')}{' '}
        {t('jlpt.examModeCurrent')}{' '}
        <b className="text-foreground">{t(`jlpt.examMode.${mode}`)}</b>
        {t('jlpt.examModeSuffix')}
        {' · '}
        {t('jlpt.examSectionOrderCurrent')}{' '}
        <b className="text-foreground">{t(`jlpt.examSectionOrder.${sectionOrder}`)}</b>
        {' · '}
        <Link className="text-accent underline-offset-2 hover:underline" to="/settings">
          {t('jlpt.goSettings')}
        </Link>
      </p>

      <Table>
        <Table.ScrollContainer>
          <Table.Content aria-label={t('jlpt.papersLabel')} className={TABLE_DENSE}>
            <Table.Header>
              <Table.Column isRowHeader>{t('jlpt.colPaper')}</Table.Column>
              <Table.Column>{t('jlpt.colProgress')}</Table.Column>
              <Table.Column className="text-end">{t('jlpt.colAction')}</Table.Column>
            </Table.Header>
            <Table.Body
              renderEmptyState={() => (
                <EmptyState className="py-10 text-center text-sm text-muted">
                  {papers ? t('jlpt.notImported') : t('jlpt.loading')}
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
                        {t('jlpt.questionCount', { count: paper.writtenTotal + paper.listeningTotal })}
                      </div>
                    </Table.Cell>

                    {/* 状态和它的那个数字叠成两行：进行中看已答多少，考完看估算分。 */}
                    <Table.Cell>
                      {attempt ? (
                        <>
                          <div className={CELL_MAIN}>
                            {phaseText[attempt.phase]}
                            {/* 暂停着的那场在列表上就标出来，不然要点进去才知道钟停着。 */}
                            {attempt.isPaused ? <span className="text-muted"> · 已暂停</span> : null}
                          </div>
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
                            <div className={CELL_SUB}>{t('jlpt.answeredCount', { count: attempt.answered })}</div>
                          )}
                        </>
                      ) : (
                        <span className="text-muted">{t('jlpt.notStarted')}</span>
                      )}
                    </Table.Cell>

                    <Table.Cell>
                      <div className={CELL_ACTIONS}>
                        {attempt ? (
                          <Link className={ACTION_LINK} to={examHref(paper)}>
                            {attempt.phase === 'done' ? t('jlpt.viewScore') : t('jlpt.resume')}
                          </Link>
                        ) : (
                          <Button
                            isPending={isBusy}
                            size="sm"
                            onPress={() => void start(paper)}
                          >
                            {t('jlpt.startExam')}
                          </Button>
                        )}
                        {/* 没考过就没得重置 —— 与其摆一个永远灰着的按钮，不如不占这一格。 */}
                        {attempt ? (
                          <Tooltip delay={300}>
                            <Button
                              isIconOnly
                              aria-label={t('jlpt.resetPaper')}
                              isDisabled={isBusy}
                              size="sm"
                              variant="ghost"
                              onPress={() => void reset(paper)}
                            >
                              <RotateCcw className="size-4" aria-hidden />
                            </Button>
                            <Tooltip.Content>{t('jlpt.resetPaper')}</Tooltip.Content>
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
