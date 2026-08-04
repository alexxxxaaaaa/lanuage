import { Chip } from '@heroui/react'
import type { JlptLevel } from '../lib/jlptVocab'

/** 级别数字越小越难，颜色跟着难度走，不用读字也知道深浅。 */
const LEVEL_COLOR = {
  N1: 'danger',
  N2: 'warning',
  N3: 'accent',
  N4: 'success',
} as const satisfies Record<JlptLevel, 'danger' | 'warning' | 'accent' | 'success'>

type Props = {
  levels: readonly JlptLevel[]
  /** 跟着同一行里其它标签走：索引栏和查词结果是 sm，词卡上的是 md。 */
  size?: 'sm' | 'md'
  className?: string
}

/**
 * 一个词的 JLPT 级别标签。出題基準里跨了几个级别的词（「頭」1/2/4 級）全部并排。
 *
 * 没级别就整个不渲染 —— 返回 null 而不是空 span，外层 flex 的 gap 才不会
 * 在没有标签的行上留出一段空隙。
 */
export function JlptChips({ levels, size = 'sm', className }: Props) {
  if (levels.length === 0) return null

  return (
    <span className={`flex shrink-0 items-center gap-1 ${className ?? ''}`}>
      {levels.map((level) => (
        <Chip key={level} size={size} variant="soft" color={LEVEL_COLOR[level]}>
          <Chip.Label>{level}</Chip.Label>
        </Chip>
      ))}
    </span>
  )
}
