/**
 * JLPT 板块的公共样式，外加选项在揭晓后怎么着色/挂标签的那点映射。
 * 目录、精练、模拟考试渲染的是同一批题，版式也该是同一套。
 */

// ===== 目录/列表行 =====
// 每一行都是同一个骨架：左边标签、中间说明、右边状态 + 入口。
// ≤900px 时说明文字换到第三行独占一行，标签和状态并排。
export const ROW =
  'flex items-center gap-3.5 px-4 py-3 max-[900px]:flex-wrap max-[900px]:gap-x-3 max-[900px]:gap-y-2'
export const ROW_LABEL = 'min-w-[76px] shrink-0 text-[13px] font-semibold text-accent'
export const ROW_MAIN = 'min-w-0 flex-1 max-[900px]:order-3 max-[900px]:basis-full'
export const ROW_TITLE = 'm-0 text-sm font-semibold text-foreground'
/** 跳转型入口是 <Link> 套 HeroUI 的按钮类，样式和别处的按钮一致。 */
export const ROW_LINK = 'button button--outline button--sm shrink-0 text-accent'

/**
 * 选项按钮。
 *
 * 脱掉 HeroUI `.button` 的固定高度和 nowrap，日文长句才能折行；作答后按钮
 * disabled，但答案要看得清，所以把 disabled 的半透明加回不透明。
 */
export const OPTION =
  'h-auto w-full items-start justify-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-left text-[15px]/[1.7] font-normal whitespace-normal disabled:cursor-default disabled:opacity-100'

export const OPTION_TONE = {
  /** 复习态：正确答案 */
  answer: 'border-success bg-success-soft text-success-soft-foreground hover:bg-success-soft',
  /** 复习态：分歧题里另一来源的答案，同样判对，用另一个色区分开 */
  alt: 'border-warning bg-warning-soft text-warning-soft-foreground hover:bg-warning-soft',
  /** 复习态：选错的那项 */
  wrong: 'border-danger bg-danger-soft text-danger-soft-foreground hover:bg-danger-soft',
  /** 作答态：当前选中，不透露对错 */
  picked: 'border-accent bg-accent/10 text-foreground hover:bg-accent/10',
  idle: 'border-border bg-surface text-foreground hover:border-accent hover:bg-accent/6',
} as const

export const OPTION_NUM =
  'mt-0.5 inline-flex size-[22px] shrink-0 items-center justify-center rounded-full border border-current text-xs'

export const OPTION_TAG = 'ml-auto shrink-0 self-center'

/**
 * 揭晓后一个选项扮演的角色，决定它的配色和标签。null = 平平无奇的错误选项，
 * 不着色也不挂标签。
 *
 * alt 是「两来源答案不一致」时另一来源给的那个，判分同样算对
 * （服务端口径见 qbankService.isAcceptedAnswer），所以它绝不能落进 wrong。
 */
export type OptionRole = 'answer' | 'alt' | 'wrong'

export function optionRole(
  option: number,
  { answer, altAnswer, selected }: { answer: number; altAnswer: number; selected: number | null },
): OptionRole | null {
  if (option === answer) return 'answer'
  if (altAnswer > 0 && option === altAnswer) return 'alt'
  return option === selected ? 'wrong' : null
}

export const OPTION_ROLE_LABEL: Record<OptionRole, string> = {
  answer: '正确答案',
  alt: '也算正确',
  wrong: '你的选择',
}

export const OPTION_ROLE_COLOR = {
  answer: 'success',
  alt: 'warning',
  wrong: 'danger',
} as const

/** 阅读材料 / 听力原文的框。 */
export const PASSAGE_BOX =
  'rounded-[14px] border-l-[3px] border-accent/40 bg-foreground/3 px-4.5 py-3.5'

export const EXPLAIN_LABEL = 'mt-0 mb-0.5 text-xs font-semibold whitespace-normal text-accent'
export const EXPLAIN_BLOCK = 'multiline-text text-sm/[1.85] text-foreground'
