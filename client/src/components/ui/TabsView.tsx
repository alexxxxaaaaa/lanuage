import type { ReactNode } from 'react'
import { Tabs } from '@heroui/react'

// antd-style `items` API over HeroUI's compound Tabs. Both call sites build the
// tab list from data, so the declarative array is the natural shape here.

export type TabItem = {
  key: string
  label: ReactNode
  children: ReactNode
}

type TabsViewProps = {
  items: TabItem[]
  activeKey?: string
  onChange?: (key: string) => void
  variant?: 'primary' | 'secondary'
  className?: string
  'aria-label'?: string
}

export function TabsView({
  items,
  activeKey,
  onChange,
  variant,
  className,
  'aria-label': ariaLabel,
}: TabsViewProps) {
  return (
    <Tabs
      className={className}
      selectedKey={activeKey}
      variant={variant}
      onSelectionChange={(key) => onChange?.(String(key))}
    >
      <Tabs.ListContainer>
        <Tabs.List aria-label={ariaLabel ?? 'Tabs'}>
          {items.map((item) => (
            <Tabs.Tab key={item.key} id={item.key}>
              {item.label}
              <Tabs.Indicator />
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </Tabs.ListContainer>
      {items.map((item) => (
        <Tabs.Panel key={item.key} className="pt-4" id={item.key}>
          {item.children}
        </Tabs.Panel>
      ))}
    </Tabs>
  )
}
