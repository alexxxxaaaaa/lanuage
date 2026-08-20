import { Button, ButtonGroup, Spinner } from '@heroui/react'
import { Sparkles } from 'lucide-react'

import type { QbankAiExplain } from '../../api/qbank'
import { EXPLAIN_BLOCK, EXPLAIN_LABEL, OPTION_NUM, OPTION_ROLE_NUM, optionRole } from './styles'

/**
 * AI 逐选项解析的两个零件，精练页和模拟考试复盘页共用。
 * 生成状态在 useAiExplain.ts。
 */

type BlockProps = {
  /** 这道题当前该显示的那份：生成过的优先，否则是正文带下来的缓存。 */
  explain: QbankAiExplain | null | undefined
  isPending: boolean
  answer: number
  altAnswer: number
  selected: number | null
  onRegenerate: () => void
}

/** 没解析也没在生成时整块不渲染，所以调用方直接摆着就行，不用自己判空。 */
export function AiExplainBlock({
  explain,
  isPending,
  answer,
  altAnswer,
  selected,
  onRegenerate,
}: BlockProps) {
  if (!explain && !isPending) return null

  return (
    <div className={EXPLAIN_BLOCK}>
      <div className="mb-0.5 flex items-center gap-2">
        <p className={`${EXPLAIN_LABEL} mb-0`}>AI 解析</p>
        {/* refresh 会重算并覆盖所有人看到的那一份，所以只挂在「重新生成」上。 */}
        {explain && !isPending ? (
          <Button
            className="h-auto px-1.5 py-0 text-xs font-normal"
            size="sm"
            variant="ghost"
            onPress={onRegenerate}
          >
            重新生成
          </Button>
        ) : null}
      </div>
      {isPending ? (
        <p className="muted m-0 flex items-center gap-2 text-sm">
          <Spinner size="sm" />
          正在生成…
        </p>
      ) : explain ? (
        <>
          {explain.summary ? <p className="m-0">{explain.summary}</p> : null}
          {/* 每一条都摆出来，包括正确答案那条。服务端保证不空，「—」只兜住
              旧版本留下的残缺缓存 —— 那种点一下「重新生成」就补齐了。 */}
          <ol className="m-0 mt-1.5 grid list-none gap-1.5 p-0">
            {explain.options.map((text, i) => {
              const role = optionRole(i + 1, { answer, altAnswer, selected })
              return (
                <li key={i} className="flex gap-2">
                  <span className={`${OPTION_NUM} ${role ? OPTION_ROLE_NUM[role] : 'text-muted'}`}>
                    {i + 1}
                  </span>
                  <span className={`min-w-0 flex-1 ${text ? '' : 'muted'}`}>{text || '—'}</span>
                </li>
              )
            })}
          </ol>
        </>
      ) : null}
    </div>
  )
}

type ButtonProps = {
  isPending: boolean
  hasExplain: boolean
  /** 答案还没揭晓 —— 解析含正确答案，这时候生成等于剧透。只有精练页会锁。 */
  isLocked?: boolean
  /** 摆进 ButtonGroup 时要带的分隔线，HeroUI v3 把它放在 Button 内部。 */
  withSeparator?: boolean
  /** 不在 ButtonGroup 里时得自己定，组里的交给 group 的 context。 */
  variant?: 'outline'
  onPress: () => void
}

/**
 * 三种停用状态各自把话说清楚，别只剩一个灰按钮让人猜：
 * 生成中、已经有解析了（重算走解析区里的「重新生成」）、答案还没揭晓。
 */
export function AiExplainButton({
  isPending,
  hasExplain,
  isLocked,
  withSeparator,
  variant,
  onPress,
}: ButtonProps) {
  return (
    <Button
      isDisabled={isLocked || isPending || hasExplain}
      size="sm"
      variant={variant}
      onPress={onPress}
    >
      {withSeparator ? <ButtonGroup.Separator /> : null}
      <Sparkles aria-hidden />
      {isPending ? '生成中…' : hasExplain ? '已有解析' : 'AI 解析'}
    </Button>
  )
}
