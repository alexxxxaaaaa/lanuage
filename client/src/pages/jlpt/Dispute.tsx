import { Chip } from '@heroui/react'
import { TriangleAlert } from 'lucide-react'

/**
 * 答案分歧的呈现。全库有 11 道题两个题库来源给出的答案不同，官方答案无从查证，
 * 所以站点两个答案都判对（判分口径见 server/src/services/qbankService.ts 的
 * isAcceptedAnswer），这里只负责把这件事说清楚。
 *
 * 三处露出，精练页和模考复习页共用：
 *   题干标签  DisputeChip   —— 精练页里没作答就看得到，提醒这题的答案本身有争议
 *   选项标签  见 styles.ts 的 optionRole —— 揭晓后两个候选各挂一个
 *   说明块    DisputeNotice —— 解析区，写明两边各给什么、为什么都算对
 *
 * 数据只有 answer / altAnswer 两个数字，来源名不入库：交叉比对脚本里
 * external_source 恒为 mojidict、answer 那侧恒为纳豆
 * （见 server/scripts/nadou/compare_sources.py），将来多一个来源要回来改这里。
 */
const SOURCE_OF_ANSWER = '纳豆'
const SOURCE_OF_ALT = 'mojidict'

export function DisputeChip() {
  return (
    <Chip className="shrink-0" color="warning" variant="soft">
      答案有分歧
    </Chip>
  )
}

/** note 是人工写的争点说明，多数分歧没有。 */
export function DisputeNotice({
  answer,
  altAnswer,
  note,
}: {
  answer: number
  altAnswer: number
  note: string
}) {
  return (
    <div className="grid gap-1.5 rounded-xl border border-warning/40 bg-warning-soft/50 px-3.5 py-2.5">
      <p className="m-0 flex items-center gap-1.5 text-xs font-semibold text-warning-soft-foreground">
        <TriangleAlert className="size-3.5" aria-hidden />
        答案有分歧 · 两个选项都算答对
      </p>
      <p className="m-0 text-sm/[1.8] text-foreground">
        {SOURCE_OF_ANSWER}给 {answer}，{SOURCE_OF_ALT}给 {altAnswer}。官方答案无从查证，
        所以选中任意一个都记作答对，不影响成绩。
      </p>
      {note ? <p className="multiline-text m-0 text-sm/[1.8] text-foreground">{note}</p> : null}
    </div>
  )
}
