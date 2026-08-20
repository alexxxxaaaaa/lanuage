import type { ReactNode } from 'react'
import { Tabs } from '@heroui/react'

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
  className?: string
  'aria-label'?: string
}

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  className,
  'aria-label': ariaLabel,
}: SegmentedControlProps<T>) {
  return (
    <Tabs
      className={className}
      selectedKey={value}
      onSelectionChange={(key) => onChange(String(key) as T)}
    >
      <Tabs.ListContainer>
        <Tabs.List aria-label={ariaLabel ?? 'Options'}>
          {options.map((option) => (
            // nowrap：分段控件是并排的开关，标签折行会把药丸撑成两行高
            // （「全部题目」断成「全部题/目」）。宽度不够时应该整体溢出/换行，
            // 而不是在词中间断开。
            <Tabs.Tab
              key={option.value}
              id={option.value}
              className="whitespace-nowrap"
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
