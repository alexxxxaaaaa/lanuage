import { Button } from '@heroui/react'
import { Menu } from 'lucide-react'

import { LocaleSwitcher } from './LocaleSwitcher'
import { ThemeToggle } from './ThemeToggle'
import { TopbarBreadcrumbs } from './TopbarBreadcrumbs'
import { useI18n } from '../../i18n'

export function Topbar({ onOpenMenu }: { onOpenMenu: () => void }) {
  const { t } = useI18n()

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border bg-surface px-4">
      <div className="flex min-w-0 items-center gap-2">
        <Button
          isIconOnly
          variant="ghost"
          className="md:hidden"
          aria-label={t('sidebar.openMenu')}
          onPress={onOpenMenu}
        >
          <Menu className="size-5" aria-hidden />
        </Button>
        <TopbarBreadcrumbs />
      </div>
      <div className="flex items-center gap-1">
        <ThemeToggle />
        <LocaleSwitcher />
      </div>
    </header>
  )
}
