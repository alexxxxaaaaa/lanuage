import { Card, NumberField } from '@heroui/react'
import { useEffect, useState } from 'react'

import { SelectField } from './ui/SelectField'
import { Stat } from './ui/Stat'
import { getAiUsage, type AiUsageSummary } from '../api/ai'
import { useI18n } from '../i18n'

const DAY_RANGES = [7, 30, 90] as const

const NUMBER_FORMAT = new Intl.NumberFormat('en-US')

/** The period each result belongs to, so a stale one reads as "still loading". */
type UsageState =
  | { status: 'ok'; days: number; data: AiUsageSummary }
  | { status: 'error'; days: number }

/**
 * AI spend at a glance: calls, prompt/completion tokens and an estimated bill.
 *
 * The unit price is a local knob, not a server value — the model behind the
 * app changes faster than any price table we could ship, so the user sets the
 * rate and we do the arithmetic.
 */
export function AiUsageCard() {
  const { t } = useI18n()
  const [days, setDays] = useState<number>(7)
  const [usage, setUsage] = useState<UsageState | null>(null)
  const [pricePerMillion, setPricePerMillion] = useState(2)

  useEffect(() => {
    let cancelled = false
    getAiUsage(days)
      .then((data) => {
        if (!cancelled) setUsage({ status: 'ok', days, data })
      })
      .catch(() => {
        if (!cancelled) setUsage({ status: 'error', days })
      })
    return () => {
      cancelled = true
    }
  }, [days])

  // Loading is "what we hold isn't for the period on screen" rather than its
  // own flag — one less state to keep in step, and no setState during render.
  const isLoading = usage?.days !== days
  const data = usage?.status === 'ok' ? usage.data : null
  const totals = data?.totals
  const cost =
    (((totals?.promptTokens ?? 0) + (totals?.completionTokens ?? 0)) / 1_000_000) *
    pricePerMillion

  const format = (value: number | undefined) =>
    value === undefined ? '—' : NUMBER_FORMAT.format(value)

  return (
    <Card>
      <Card.Header className="flex-row flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <Card.Title>{t('home.usageTitle')}</Card.Title>
          <Card.Description>
            {t('home.usageModel', { model: data?.model ?? '—' })}
          </Card.Description>
        </div>
        <SelectField
          aria-label={t('home.usagePeriod')}
          className="min-w-[132px]"
          value={days}
          onChange={setDays}
          options={DAY_RANGES.map((value) => ({
            value,
            label: t('home.usageDays', { days: value }),
          }))}
        />
      </Card.Header>

      <Card.Content
        className={
          'grid grid-cols-2 gap-5 sm:grid-cols-4 ' +
          (isLoading ? 'opacity-50 transition-opacity' : 'transition-opacity')
        }
      >
        <Stat label={t('home.usageCalls')} value={format(totals?.calls)} />
        <Stat label={t('home.usageInput')} value={format(totals?.promptTokens)} />
        <Stat label={t('home.usageOutput')} value={format(totals?.completionTokens)} />
        <Stat
          accent
          label={t('home.usageCost')}
          value={totals ? `$${cost.toFixed(4)}` : '—'}
        />
      </Card.Content>

      <Card.Footer className="flex-wrap items-center gap-2 text-xs text-muted">
        {usage?.status === 'error' ? (
          <span className="text-danger">{t('home.usageError')}</span>
        ) : (
          <>
            <span>{t('home.usagePrice')}</span>
            <NumberField
              aria-label={t('home.usagePrice')}
              className="w-[132px]"
              minValue={0}
              step={0.1}
              value={pricePerMillion}
              onChange={(next) => {
                setPricePerMillion(Number.isFinite(next) && next >= 0 ? next : 0)
              }}
            >
              <NumberField.Group>
                <NumberField.DecrementButton />
                <NumberField.Input />
                <NumberField.IncrementButton />
              </NumberField.Group>
            </NumberField>
          </>
        )}
      </Card.Footer>
    </Card>
  )
}
