import { Button, Card, Chip, ProgressCircle } from '@heroui/react'

import type { ExamScore } from '../../api/qbankExam'
import { EXAM_SECTIONS, formatClock } from './constants'

/**
 * 成绩单。官方的原始分→得点换算表不公开，所以「得点」是按各分区正答率
 * 折算的估算值（每区 0–60，总分 0–180），合格线照官方：总分 100 且每区 19。
 */

type Props = {
  score: ExamScore
  startedAt: string
  writtenSubmittedAt: string | null
  finishedAt: string | null
  wrongCount: number
  isCollecting: boolean
  onCollectWrong: () => void
}

function spent(from: string | null, to: string | null): string {
  if (!from || !to) return '—'
  return formatClock(new Date(to).getTime() - new Date(from).getTime())
}

export function ExamScoreCard({
  score,
  startedAt,
  writtenSubmittedAt,
  finishedAt,
  wrongCount,
  isCollecting,
  onCollectWrong,
}: Props) {
  return (
    <Card className="gap-4">
      <Card.Header className="flex-row flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-2.5">
          <span className="text-[40px] leading-none font-bold tabular-nums text-foreground">
            {score.points}
          </span>
          <span className="muted text-sm">/ 180 估算得点</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Chip color={score.passed ? 'success' : 'danger'} variant="soft">
            {score.passed ? '估算合格' : '估算未达线'}
          </Chip>
          <Chip>
            答对 {score.correct} / {score.total}
          </Chip>
        </div>
      </Card.Header>

      <Card.Content className="gap-4">
        <div className="grid grid-cols-3 gap-3 max-[700px]:grid-cols-1">
          {score.sections.map((section) => (
            <div
              className="flex items-center gap-3 rounded-[14px] border border-border bg-accent/5 px-3.5 py-3"
              key={section.key}
            >
              <ProgressCircle
                aria-label={EXAM_SECTIONS[section.key] ?? section.key}
                maxValue={Math.max(section.total, 1)}
                size="lg"
                value={section.correct}
              >
                <ProgressCircle.Track>
                  <ProgressCircle.TrackCircle />
                  <ProgressCircle.FillCircle />
                </ProgressCircle.Track>
              </ProgressCircle>
              <div className="min-w-0">
                <p className="m-0 truncate text-xs font-semibold text-accent">
                  {EXAM_SECTIONS[section.key] ?? section.key}
                </p>
                <p className="m-0 text-lg font-bold tabular-nums text-foreground">
                  {section.points}
                  <span className="muted text-xs font-normal"> / 60</span>
                </p>
                <p className="muted m-0 text-xs tabular-nums">
                  答对 {section.correct}/{section.total}
                  {section.total > 0 && section.points < 19 ? ' · 低于分区线' : ''}
                </p>
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs tabular-nums text-muted">
          <span>笔试用时 {spent(startedAt, writtenSubmittedAt)}</span>
          <span>听力用时 {spent(writtenSubmittedAt, finishedAt)}</span>
          <span>合格线：总分 100 且每分区 19（官方换算表不公开，得点为估算值）</span>
        </div>

        {wrongCount > 0 ? (
          <div className="flex flex-wrap items-center gap-3 border-t border-separator pt-3.5">
            <Button isPending={isCollecting} size="sm" variant="outline" onPress={onCollectWrong}>
              把 {wrongCount} 道错题加入错题本
            </Button>
            <span className="muted text-xs">
              考试记录独立保存，不影响平时练习的答题卡；收进去之后可以在「收藏 / 错题」里重做。
            </span>
          </div>
        ) : null}
      </Card.Content>
    </Card>
  )
}
