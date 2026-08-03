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
            <Tabs.Tab key={option.value} id={option.value}>
              {option.label}
              <Tabs.Indicator />
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </Tabs.ListContainer>
    </Tabs>
  )
}
