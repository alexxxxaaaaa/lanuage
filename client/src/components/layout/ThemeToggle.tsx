import { Button } from '@heroui/react'
import { Moon, Sun } from 'lucide-react'

import { useI18n } from '../../i18n'
import { useTheme } from '../../providers/themeContext'

/**
 * Two-state toggle: light ⇄ dark. There is no "follow the system" option —
 * the app picks the OS preference for a first-time visitor and then keeps
 * whatever the user chose.
 */
export function ThemeToggle() {
  const { t } = useI18n()
  const { theme, setTheme } = useTheme()
  const isDark = theme === 'dark'

  return (
    <Button
      variant="ghost"
      isIconOnly
      aria-label={`${t('topbar.toggleTheme')} (${t(isDark ? 'topbar.themeDark' : 'topbar.themeLight')})`}
      onPress={() => setTheme(isDark ? 'light' : 'dark')}
    >
      {isDark ? <Moon className="size-4" aria-hidden /> : <Sun className="size-4" aria-hidden />}
    </Button>
  )
}
