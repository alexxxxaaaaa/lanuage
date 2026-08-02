import { Button, Dropdown, Label } from '@heroui/react'
import { Languages } from 'lucide-react'

import { useI18n, type UiLanguage } from '../../i18n'

const LOCALES: readonly UiLanguage[] = ['zh', 'en', 'jp']

/**
 * UI language picker. The console cycles through its (single) locale with a
 * plain button; with three locales a dropdown is the honest control — the user
 * can jump straight to the one they want instead of tapping through.
 */
export function LocaleSwitcher() {
  const { language, setLanguage, t } = useI18n()

  return (
    <Dropdown>
      <Button variant="ghost" isIconOnly aria-label={`${t('topbar.language')} (${t(`nav.${language}`)})`}>
        <Languages className="size-4" aria-hidden />
      </Button>
      <Dropdown.Popover className="min-w-40">
        <Dropdown.Menu
          selectionMode="single"
          selectedKeys={new Set([language])}
          onSelectionChange={(keys) => {
            const next = [...(keys as Set<string>)][0]
            if (next) setLanguage(next as UiLanguage)
          }}
        >
          {LOCALES.map((locale) => (
            <Dropdown.Item key={locale} id={locale} textValue={t(`nav.${locale}`)}>
              <Dropdown.ItemIndicator />
              <Label>{t(`nav.${locale}`)}</Label>
            </Dropdown.Item>
          ))}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  )
}
