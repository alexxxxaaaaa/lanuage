import { Button } from '@heroui/react'
import { Monitor, Moon, Sun } from 'lucide-react'

import { useI18n } from '../../i18n'
import { useTheme, type Theme } from '../../providers/themeContext'

const CYCLE = ['light', 'dark', 'system'] as const

/**
 * Single-button cycle: light → dark → system. Keeps the topbar compact and
 * sidesteps the react-aria selection plumbing a dropdown would need.
 */
export function ThemeToggle() {
  const { t } = useI18n()
  const { theme, setTheme, resolvedTheme } = useTheme()

  const next: Theme = CYCLE[(CYCLE.indexOf(theme as never) + 1) % CYCLE.length]!

  const Icon =
    theme === 'system' ? Monitor : resolvedTheme === 'dark' ? Moon : Sun

  const label =
    theme === 'light'
      ? t('topbar.themeLight')
      : theme === 'dark'
        ? t('topbar.themeDark')
        : t('topbar.themeSystem')

  return (
    <Button
      variant="ghost"
      isIconOnly
      aria-label={`${t('topbar.toggleTheme')} (${label})`}
      onPress={() => setTheme(next)}
    >
      <Icon className="size-4" aria-hidden />
    </Button>
  )
}
