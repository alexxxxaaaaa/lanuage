import type { ReactNode } from 'react'
import { ToggleButton, ToggleButtonGroup } from '@heroui/react'

// antd's Segmented in HeroUI terms: a single-select ToggleButtonGroup that
// always keeps one option chosen.

type SegmentedOption<T extends string> = {
  value: T
  label: ReactNode
}

type SegmentedControlProps<T extends string> = {
  value: T
  onChange: (value: T) => void
  options: SegmentedOption<T>[]
  size?: 'sm' | 'md' | 'lg'
  className?: string
  'aria-label'?: string
}

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  size,
  className,
  'aria-label': ariaLabel,
}: SegmentedControlProps<T>) {
  return (
    <ToggleButtonGroup
      disallowEmptySelection
      aria-label={ariaLabel}
      className={className}
      selectedKeys={[value]}
      selectionMode="single"
      size={size}
      onSelectionChange={(keys) => {
        const next = [...keys][0]
        if (next != null) onChange(String(next) as T)
      }}
    >
      {options.map((option, i) => (
        <ToggleButton key={option.value} id={option.value}>
          {i > 0 ? <ToggleButtonGroup.Separator /> : null}
          {option.label}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  )
}
