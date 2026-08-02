import { useState, type ReactNode } from 'react'
import { Button, Card, Chip, ProgressCircle } from '@heroui/react'

import type { ExamQuestion } from '../../api/qbankExam'
import { questionDomId } from './constants'

/**
 * 答题卡。右栏吸顶，≤900px 时塌到题目上方，题号点阵折叠起来。
 *
 * 点阵是纯导航：点一下滚到那道题。真考场的答题卡也只有「这题填没填」，
 * 所以作答态下这里绝不透露对错。
 */

// HeroUI 的 .button 是固定 h-10/w-fit 的胶囊，这里要的是小圆点，宽高一起写死。
const DOT = 'size-9 rounded-full p-0 text-xs tabular-nums md:size-8'

type Props = {
  questions: ExamQuestion[]
  numbers: Map<string, number>
  answers: Record<string, number>
  /** 正在播放的听力题，点阵上描一圈。 */
  activeIds?: ReadonlySet<string>
  /** 计时器 / 播放进度等阶段专属内容。 */
  children?: ReactNode
  action?: ReactNode
}

export function ExamAnswerSheet({ questions, numbers, answers, activeIds, children, action }: Props) {
  const [isGridOpen, setIsGridOpen] = useState(false)
  const answered = questions.reduce((n, q) => (answers[q.id] ? n + 1 : n), 0)

  const jump = (id: string) => {
    document.getElementById(questionDomId(id))?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }

  return (
    <Card
      className="sticky top-4 z-[5] gap-2.5 p-4 max-[900px]:top-2 max-[900px]:order-first"
      render={(props) => <aside {...props} />}
    >
      <Card.Header className="flex-row items-center justify-between gap-2">
        <Card.Title className="text-[15px]">答题卡</Card.Title>
      </Card.Header>
      <Card.Content className="gap-2.5">
        {/* 倒计时 / 播放状态摆最上面：做题时眼睛最先扫到的就是这里。 */}
        {children}
        <div className="flex flex-wrap gap-1.5">
          <Chip color="accent" variant="soft">
            已答 {answered}
          </Chip>
          <Chip>未答 {questions.length - answered}</Chip>
        </div>
        {/* 和精练页的答题卡同一个版式：左边圆环是作答进度，右边是数字。 */}
        <div className="flex items-center gap-3">
          <ProgressCircle
            aria-label="作答进度"
            maxValue={Math.max(questions.length, 1)}
            size="lg"
            value={answered}
          >
            <ProgressCircle.Track>
              <ProgressCircle.TrackCircle />
              <ProgressCircle.FillCircle />
            </ProgressCircle.Track>
          </ProgressCircle>
          <div>
            <p className="m-0 text-lg font-bold tabular-nums text-foreground">
              {answered}/{questions.length}
            </p>
            <p className="muted m-0 text-xs tabular-nums">
              {questions.length > 0 ? Math.round((answered / questions.length) * 100) : 0}% 已作答
            </p>
          </div>
        </div>
        <Button
          className="hidden max-[900px]:flex"
          size="sm"
          variant="outline"
          aria-expanded={isGridOpen}
          onPress={() => setIsGridOpen((v) => !v)}
        >
          {isGridOpen ? '收起题号' : `展开题号（${questions.length}）`}
        </Button>
        <div
          className={`grid max-h-[42vh] grid-cols-[repeat(auto-fill,minmax(2.25rem,1fr))] justify-items-center gap-1.5 overflow-y-auto max-[900px]:max-h-[32vh] ${
            isGridOpen ? '' : 'max-[900px]:hidden'
          }`}
        >
          {questions.map((q) => {
            const isAnswered = !!answers[q.id]
            return (
              <Button
                key={q.id}
                size="sm"
                variant={isAnswered ? 'primary' : 'tertiary'}
                className={`${DOT} ${activeIds?.has(q.id) ? 'outline-2 outline-offset-1 outline-accent' : ''}`}
                render={(props) => <button {...props} title={q.seq} />}
                onPress={() => jump(q.id)}
              >
                {numbers.get(q.id)}
              </Button>
            )
          })}
        </div>
        {action}
      </Card.Content>
    </Card>
  )
}
