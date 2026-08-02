import { Card } from '@heroui/react'
import { Moon, Sun } from 'lucide-react'

import { SegmentedControl } from '../components/ui/SegmentedControl'
import { useI18n, type UiLanguage } from '../i18n'
import { useTheme, type Theme } from '../providers/themeContext'

const LOCALES: readonly UiLanguage[] = ['zh', 'en', 'jp']

export function SettingsPage() {
  const { language, setLanguage, t } = useI18n()
  const { theme, setTheme } = useTheme()

  return (
    <section className="page">
      <div>
        <p className="eyebrow">Settings</p>
        <h2>{t('routes.settings')}</h2>
      </div>

      <Card>
        <Card.Header>
          <Card.Title>{t('settings.language')}</Card.Title>
          <Card.Description>{t('settings.languageDesc')}</Card.Description>
        </Card.Header>
        <Card.Content>
          <SegmentedControl<UiLanguage>
            aria-label={t('settings.language')}
            value={language}
            onChange={setLanguage}
            options={LOCALES.map((locale) => ({ value: locale, label: t(`nav.${locale}`) }))}
          />
        </Card.Content>
      </Card>

      <Card>
        <Card.Header>
          <Card.Title>{t('settings.theme')}</Card.Title>
          <Card.Description>{t('settings.themeDesc')}</Card.Description>
        </Card.Header>
        <Card.Content>
          <SegmentedControl<Theme>
            aria-label={t('settings.theme')}
            value={theme}
            onChange={setTheme}
            options={[
              {
                value: 'light',
                label: (
                  <>
                    <Sun className="size-4" aria-hidden />
                    {t('topbar.themeLight')}
                  </>
                ),
              },
              {
                value: 'dark',
                label: (
                  <>
                    <Moon className="size-4" aria-hidden />
                    {t('topbar.themeDark')}
                  </>
                ),
              },
            ]}
          />
        </Card.Content>
      </Card>
    </section>
  )
}
