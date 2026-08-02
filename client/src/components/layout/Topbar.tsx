import { Button } from '@heroui/react'
import { Menu } from 'lucide-react'

import { ThemeToggle } from './ThemeToggle'
import { TopbarBreadcrumbs } from './TopbarBreadcrumbs'
import { useI18n } from '../../i18n'

/**
 * Transparent header: it shares the shell's background with `<main>` so the
 * page reads as one surface, with no chrome line between crumb and content.
 */
export function Topbar({ onOpenMenu }: { onOpenMenu: () => void }) {
  const { t } = useI18n()

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-2 px-4 pr-[max(1rem,env(safe-area-inset-right))]">
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
      <ThemeToggle />
    </header>
  )
}
