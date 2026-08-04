import type { ReactNode } from 'react'
import { Tabs, cn } from '@heroui/react'

// antd's Segmented in HeroUI terms: the default pill-style Tabs used as a
// single-select control. Panels live in the caller's own state — Tabs here is
// purely the switcher, so there are no Tabs.Panel children.

type SegmentedOption<T extends string> = {
  value: T
  label: ReactNode
}

type SegmentedControlProps<T extends string> = {
  value: T
  onChange: (value: T) => void
  options: SegmentedOption<T>[]
  /**
   * 每段按各自标签的宽度排布，控件整体收缩到内容宽度（antd Segmented 的默认行为）。
   *
   * 不开时沿用 HeroUI 的 `.tabs__tab { width: 100% }`：所有分段等宽、铺满容器，
   * 适合卡片里独占一行的切换器（设置页）。但标签长短悬殊时（「全部题目 / 错题本」）
   * 等宽会把短的那段撑得空荡荡，这时候开启。
   */
  fitContent?: boolean
  className?: string
  'aria-label'?: string
}

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  fitContent = false,
  className,
  'aria-label': ariaLabel,
}: SegmentedControlProps<T>) {
  return (
    // fitContent 的两处覆盖都靠层级取胜，不用 `!`：HeroUI 的 BEM 样式在 components
    // 层，Tailwind 工具类在 utilities 层，天然压过前者。
    // · 根节点 `w-fit` —— 只改 tab 还不够：`.tabs__list` 是 `min-w-full`，容器一旦
    //   被拉宽，胶囊底色就会在末尾拖出一截空白。
    // · tab 的 `w-auto` —— 解掉 `.tabs__tab` 的 w-full，分段才会各自按标签宽度排。
    <Tabs
      className={cn(fitContent && 'w-fit', className)}
      selectedKey={value}
      onSelectionChange={(key) => onChange(String(key) as T)}
    >
      <Tabs.ListContainer>
        <Tabs.List aria-label={ariaLabel ?? 'Options'}>
          {options.map((option) => (
            <Tabs.Tab
              key={option.value}
              id={option.value}
              className={fitContent ? 'w-auto' : undefined}
            >
              {option.label}
              <Tabs.Indicator />
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </Tabs.ListContainer>
    </Tabs>
  )
}
