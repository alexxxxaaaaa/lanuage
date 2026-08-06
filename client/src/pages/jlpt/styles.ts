/**
 * JLPT 板块的公共样式，外加选项在揭晓后怎么着色/挂标签的那点映射。
 * 目录、精练、模拟考试渲染的是同一批题，版式也该是同一套。
 */

// ===== 目录表格 =====
/*
 * 三张目录表（模拟考试 / 精练 / 收藏错题）是同一套排版：一列主体（两行文字）、
 * 一列数字、一列操作按钮。三列都按内容取宽，加起来约 340px —— 这是照着 375px
 * 屏留给正文的 343px 定的，为的是手机上一屏看全、不用横滑。
 */

/**
 * 窄屏把单元格内边距收一档（16→12px）。省下的 24px 正是三列表格能不能塞进
 * 手机屏的那一档。写成挂在 <Table.Content> 上的批量选择器，比给十几个
 * <Table.Cell> 各贴一次 className 干净。
 *
 * 树形表第一列的起始边要放过：HeroUI 拿 `padding-inline-start` 画层级缩进
 * （`.table__cell[data-tree-column]`，1rem × 层级），一个同特异性的 `px-*`
 * 会连它一起冲掉，卷次行就缩不进去了。所以起始边只收非树列。
 */
export const TABLE_DENSE = [
  '**:data-[slot=table-column]:px-3 md:**:data-[slot=table-column]:px-4',
  '**:data-[slot=table-cell]:pe-3 md:**:data-[slot=table-cell]:pe-4',
  '**:data-[slot=table-cell]:not-data-tree-column:ps-3',
  'md:**:data-[slot=table-cell]:not-data-tree-column:ps-4',
].join(' ')

/** 主体列的两行：上行是标题，下行是那点说明。都不换行，列宽才不会忽宽忽窄。 */
export const CELL_MAIN = 'whitespace-nowrap font-medium text-foreground'
export const CELL_SUB = 'whitespace-nowrap text-xs tabular-nums text-muted'

/** 「已答 / 总数」这类数字列。 */
export const CELL_NUM = 'whitespace-nowrap tabular-nums text-muted'

/** 操作列靠右贴边，和表头的 text-end 对齐。 */
export const CELL_ACTIONS = 'flex items-center justify-end gap-1.5'

/** 跳转型入口是 <Link> 套 HeroUI 的按钮类，样式和别处的按钮一致。 */
export const ACTION_LINK = 'button button--outline button--sm shrink-0 text-accent'

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

/**
 * AI 解析里那排编号的着色。解析区不重复挂「正确答案」标签（上面的选项列表
 * 已经挂过一次），只让编号跟着同一套配色走，扫一眼就知道哪条讲的是哪项。
 * OPTION_NUM 的描边是 border-current，所以只定文字色就够。
 */
export const OPTION_ROLE_NUM: Record<OptionRole, string> = {
  answer: 'text-success',
  alt: 'text-warning',
  wrong: 'text-danger',
}

/** 阅读材料 / 听力原文的框。 */
export const PASSAGE_BOX =
  'rounded-[14px] border-l-[3px] border-accent/40 bg-foreground/3 px-4.5 py-3.5'

export const EXPLAIN_LABEL = 'mt-0 mb-0.5 text-xs font-semibold whitespace-normal text-accent'
export const EXPLAIN_BLOCK = 'multiline-text text-sm/[1.85] text-foreground'
