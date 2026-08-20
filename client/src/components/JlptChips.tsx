import { Chip } from '@heroui/react'
import { useGrammarLevelLabel, type GrammarLevel } from '../lib/grammarLevels'

/**
 * 难度色阶：N1 红 → N5 灰，和复习页的「又忘了 / 有点难 / 记住了」同一套语义色。
 * 自建不在这条色阶上（它不是「更难」或「更简单」），走主题色，一眼和 N 系列分开。
 *
 * 走 className 而不是 Chip 的 color 属性 —— 五个档要五种色，HeroUI 只给四种，
 * 少的那一档（金）本来就在主题里，索性都用同一种写法。
 */
const LEVEL_CLASS: Record<GrammarLevel, string> = {
  N1: 'bg-danger-soft text-danger-soft-foreground',
  N2: 'bg-warning-soft text-warning-soft-foreground',
  N3: 'bg-gold-soft text-gold-soft-foreground',
  N4: 'bg-success-soft text-success-soft-foreground',
  N5: 'bg-foreground/6 text-muted',
  CUSTOM: 'bg-accent-soft text-accent-soft-foreground',
}

type Props = {
  levels: readonly GrammarLevel[]
  /** 跟着同一行里其它标签走：索引栏和查词结果是 sm，词卡和语法卡上的是 md。 */
  size?: 'sm' | 'md'
  className?: string
}

/**
 * 一个词或一条语法的级别标签。词表那边两份判得不一样、或者同形不同读音分属不同
 * 级别时（東 = ひがし N5 / あずま N1），几个级别并排挂着，不替谁挑一个；语法条目
 * 只有一个级别，走 asGrammarLevels() 转成单元素数组进来，可能是「自建」那一档。
 *
 * 没级别就整个不渲染 —— 返回 null 而不是空 span，外层 flex 的 gap 才不会
 * 在没有标签的行上留出一段空隙。
 *
 * 外壳是 inline-flex 而不是 flex：详情页把它嵌在 <h2> 的句型后面，block 的话
 * 会自己占一行。当 flex 子项用时（其余几处都是）display 本来就会被 blockify，
 * 两种写法没差别。
 */
export function JlptChips({ levels, size = 'sm', className }: Props) {
  const label = useGrammarLevelLabel()
  if (levels.length === 0) return null

  return (
    <span className={`inline-flex shrink-0 items-center gap-1 align-middle ${className ?? ''}`}>
      {levels.map((level) => (
        <Chip key={level} size={size} variant="soft" className={LEVEL_CLASS[level]}>
          <Chip.Label>{label(level)}</Chip.Label>
        </Chip>
      ))}
    </span>
  )
}
