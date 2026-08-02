import type { ReactNode } from 'react'
import { ListBox, Select } from '@heroui/react'

// HeroUI's Select is a compound component (~8 lines per use). Every call site in
// this app renders the same flat list of options, so this adapter keeps the
// option-array shape and hides the boilerplate.
//
// Generic over the value type because some call sites key off numbers (e.g. a
// day-range picker). HeroUI collapses keys to strings, so we map the selected
// key back to the original option to hand the caller its own type back.

export type SelectOption<T extends string | number = string> = {
  value: T
  label: ReactNode
  /** Falls back to `label` when it is a plain string; needed for typeahead. */
  textValue?: string
  disabled?: boolean
}

type SelectFieldProps<T extends string | number> = {
  value: T | null | undefined
  onChange: (value: T) => void
  options: SelectOption<T>[]
  placeholder?: string
  className?: string
  isDisabled?: boolean
  fullWidth?: boolean
  variant?: 'primary' | 'secondary'
  'aria-label'?: string
}

export function SelectField<T extends string | number = string>({
  value,
  onChange,
  options,
  placeholder,
  className,
  isDisabled,
  fullWidth,
  variant,
  'aria-label': ariaLabel,
}: SelectFieldProps<T>) {
  const disabledKeys = options.filter((o) => o.disabled).map((o) => String(o.value))

  return (
    <Select
      aria-label={ariaLabel}
      className={className}
      disabledKeys={disabledKeys}
      fullWidth={fullWidth}
      isDisabled={isDisabled}
      placeholder={placeholder}
      value={value == null ? null : String(value)}
      variant={variant}
      onChange={(key) => {
        if (key == null || Array.isArray(key)) return
        const picked = options.find((o) => String(o.value) === String(key))
        if (picked) onChange(picked.value)
      }}
    >
      <Select.Trigger>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {options.map((option) => (
            <ListBox.Item
              key={String(option.value)}
              id={String(option.value)}
              textValue={
                option.textValue ??
                (typeof option.label === 'string' ? option.label : String(option.value))
              }
            >
              {option.label}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  )
}
