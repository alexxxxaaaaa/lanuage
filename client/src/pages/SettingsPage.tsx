import { Card, Switch } from '@heroui/react'
import { Moon, Sun } from 'lucide-react'

import type { ExamMode } from '../api/qbankExam'
import { SegmentedControl } from '../components/ui/SegmentedControl'
import { useI18n, type UiLanguage } from '../i18n'
import { EXAM_MODES } from './jlpt/constants'
import { useTheme, type Theme } from '../providers/themeContext'
import { useSettings } from '../store/useSettings'

const LOCALES: readonly UiLanguage[] = ['zh', 'en', 'jp']

export function SettingsPage() {
  const { language, setLanguage, t } = useI18n()
  const { theme, setTheme } = useTheme()
  const { examMode, localDictEnabled } = useSettings((state) => state.settings)
  const update = useSettings((state) => state.update)

  return (
    <section className="page">
      <div>
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

      <Card>
        <Card.Header>
          <Card.Title>{t('settings.localDict')}</Card.Title>
          <Card.Description>{t('settings.localDictDesc')}</Card.Description>
        </Card.Header>
        <Card.Content>
          <Switch
            isSelected={localDictEnabled}
            onChange={(next) => update({ localDictEnabled: next })}
          >
            <Switch.Content>
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
              {localDictEnabled ? t('settings.localDictOn') : t('settings.localDictOff')}
            </Switch.Content>
          </Switch>
        </Card.Content>
      </Card>

      <Card>
        <Card.Header>
          <Card.Title>{t('settings.examMode')}</Card.Title>
          <Card.Description>{t('settings.examModeDesc')}</Card.Description>
        </Card.Header>
        <Card.Content className="gap-3">
          <SegmentedControl<ExamMode>
            aria-label={t('settings.examMode')}
            value={examMode}
            onChange={(mode) => update({ examMode: mode })}
            options={EXAM_MODES.map((m) => ({ value: m.value, label: m.label }))}
          />
          <ul className="m-0 grid list-none gap-1.5 p-0">
            {EXAM_MODES.map((m) => (
              <li
                className={`text-[13px]/[1.6] ${
                  m.value === examMode ? 'text-foreground' : 'text-muted'
                }`}
                key={m.value}
              >
                <b>{m.label}</b>：{m.desc}
              </li>
            ))}
          </ul>
        </Card.Content>
      </Card>
    </section>
  )
}
