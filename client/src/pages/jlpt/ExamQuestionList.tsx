import { Fragment } from 'react'
import { Button, Card, Chip } from '@heroui/react'

import { QbankText } from '../../components/QbankText'
import type { ExamPassage, ExamQuestion } from '../../api/qbankExam'
import {
  hasPlaceholderOptions,
  isAcceptedAnswer,
  mondaiLabel,
  mondaiMeta,
  questionDomId,
} from './constants'
import { DisputeChip, DisputeNotice } from './Dispute'
import { ExplainText } from './ExplainText'
import {
  EXPLAIN_BLOCK,
  EXPLAIN_LABEL,
  OPTION,
  OPTION_NUM,
  OPTION_ROLE_COLOR,
  OPTION_ROLE_LABEL,
  OPTION_TAG,
  OPTION_TONE,
  PASSAGE_BOX,
  optionRole,
} from './styles'

/**
 * 整卷题目列表。真题的版面顺序就是数据里的顺序，所以只要顺着扫一遍，
 * 遇到大題号变化插一条大題头、遇到材料变化插一块材料，就还原出卷面。
 *
 * 两种形态：
 *   作答态（isReview=false）—— 只有题干和选项，选了不给对错
 *   复习态（isReview=true） —— 交卷后，展示正确答案、你的选择、译文和解析
 *
 * 答题卡靠 DOM id 跳题，见 constants 里的 questionDomId。
 */

type Props = {
  questions: ExamQuestion[]
  passages: Map<string, ExamPassage>
  numbers: Map<string, number>
  answers: Record<string, number>
  isReview?: boolean
  /** 正在播放的听力题，会高亮。 */
  activeIds?: ReadonlySet<string>
  onPick?: (questionId: string, selected: number) => void
}

export function ExamQuestionList({
  questions,
  passages,
  numbers,
  answers,
  isReview = false,
  activeIds,
  onPick,
}: Props) {
  return (
    <div className="grid gap-4">
      {questions.map((question, i) => {
        const prev = i > 0 ? questions[i - 1] : null
        const isNewMondai =
          !prev || prev.mondaiNo !== question.mondaiNo || prev.category !== question.category
        const passage = question.passageId ? passages.get(question.passageId) : undefined
        const isNewPassage = !!passage && prev?.passageId !== question.passageId
        const meta = mondaiMeta(question.category, question.mondaiNo)

        return (
          <Fragment key={question.id}>
            {isNewMondai ? (
              <header className="mt-2 border-b border-border pb-2 first:mt-0">
                <h3 className="m-0 flex flex-wrap items-baseline gap-2 text-[15px] font-bold text-foreground">
                  <span>{mondaiLabel(question.category, question.mondaiNo)}</span>
                  {meta.type ? <span>{meta.type}</span> : null}
                </h3>
                {meta.instruction ? (
                  <p className="muted mt-1 mb-0 text-[13px]/[1.6]">{meta.instruction}</p>
                ) : null}
              </header>
            ) : null}

            {isNewPassage && passage ? (
              <div className={PASSAGE_BOX}>
                <p className="mt-0 mb-1.5 text-xs font-semibold text-accent">
                  {question.category === 'listening' ? '聴解原文' : passage.type || '本文'}
                </p>
                <QbankText
                  className="multiline-text text-[15px]/[1.9] text-foreground"
                  text={passage.content}
                />
              </div>
            ) : null}

            <QuestionCard
              question={question}
              number={numbers.get(question.id) ?? i + 1}
              selected={answers[question.id] ?? null}
              isReview={isReview}
              isActive={activeIds?.has(question.id) ?? false}
              onPick={onPick}
            />
          </Fragment>
        )
      })}
    </div>
  )
}

function QuestionCard({
  question,
  number,
  selected,
  isReview,
  isActive,
  onPick,
}: {
  question: ExamQuestion
  number: number
  selected: number | null
  isReview: boolean
  isActive: boolean
  onPick?: (questionId: string, selected: number) => void
}) {
  const answer = question.answer ?? 0
  const altAnswer = question.altAnswer ?? 0
  const isCorrect = isReview && isAcceptedAnswer(question, selected ?? undefined)
  // 未交卷时 answer 不下发，altAnswer 也不下发，所以这个标签只在复习态出现；
  // 精练页的题干标签则是作答前就显示的（那边答案本来就随正文一起下发）。
  const hasDispute = isReview && altAnswer > 0

  return (
    <Card
      className={`scroll-mt-24 gap-3 ${isActive ? 'outline-2 outline-offset-2 outline-accent' : ''}`}
      id={questionDomId(question.id)}
      render={(props) => <article {...props} />}
    >
      <div className="flex items-start gap-2.5">
        <span className="shrink-0 leading-[1.7] font-bold text-foreground">{number}.</span>
        <div className="multiline-text min-w-0 flex-1 text-base/[1.8] text-foreground">
          <QbankText text={question.stemJp} />
        </div>
        {hasDispute ? <DisputeChip /> : null}
        {isReview ? (
          <Chip color={isCorrect ? 'success' : selected === null ? 'default' : 'danger'} variant="soft">
            {isCorrect ? '✓' : selected === null ? '未答' : '✗'}
          </Chip>
        ) : null}
      </div>

      <ol className="m-0 grid list-none gap-2 p-0">
        {question.options.map((option, i) => {
          const num = i + 1
          const role = isReview ? optionRole(num, { answer, altAnswer, selected }) : null
          const tone = role
            ? OPTION_TONE[role]
            : !isReview && selected === num
              ? OPTION_TONE.picked
              : OPTION_TONE.idle
          return (
            <li key={i}>
              <Button
                variant="outline"
                className={`${OPTION} ${tone}`}
                isDisabled={isReview}
                onPress={() => onPick?.(question.id, num)}
              >
                <span className={OPTION_NUM}>{num}</span>
                {hasPlaceholderOptions(question.options) ? (
                  <span className="muted">（选项由音频念出）</span>
                ) : (
                  <QbankText className="min-w-0 flex-1 [overflow-wrap:anywhere]" text={option} />
                )}
                {role ? (
                  <Chip className={OPTION_TAG} color={OPTION_ROLE_COLOR[role]} variant="soft">
                    {OPTION_ROLE_LABEL[role]}
                  </Chip>
                ) : null}
              </Button>
            </li>
          )
        })}
      </ol>

      {isReview && (question.stemZh || question.explain || hasDispute) ? (
        <div className="grid gap-2.5 border-t border-separator pt-3.5">
          {question.stemZh ? (
            <div className={EXPLAIN_BLOCK}>
              <p className={EXPLAIN_LABEL}>
                {question.category === 'listening' ? '設問' : '译文'}
              </p>
              <ExplainText text={question.stemZh} />
            </div>
          ) : null}
          {question.explain ? (
            <div className={EXPLAIN_BLOCK}>
              <p className={EXPLAIN_LABEL}>
                {question.category === 'listening' ? '原文 / 译文' : '解析'}
              </p>
              <ExplainText text={question.explain} />
            </div>
          ) : null}
          {hasDispute ? (
            <DisputeNotice
              answer={answer}
              altAnswer={altAnswer}
              note={question.disputeNote ?? ''}
            />
          ) : null}
        </div>
      ) : null}
    </Card>
  )
}
