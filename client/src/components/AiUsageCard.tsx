import { Card } from '@heroui/react'
import { useEffect, useState } from 'react'

import { SelectField } from './ui/SelectField'
import { Stat } from './ui/Stat'
import { getAiUsage, type AiUsageSummary } from '../api/ai'
import { useI18n } from '../i18n'

const DAY_RANGES = [7, 30, 90] as const

const NUMBER_FORMAT = new Intl.NumberFormat('en-US')
/** Rates run to $0.02 per 1M, so two decimals would round the cheap ones to 0. */
const RATE_FORMAT = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 3,
})

/** The period each result belongs to, so a stale one reads as "still loading". */
type UsageState =
  | { status: 'ok'; days: number; data: AiUsageSummary }
  | { status: 'error'; days: number }

/**
 * AI spend at a glance: calls, prompt/completion tokens and the bill.
 *
 * The cost arrives priced. Which of the four rates (fresh input, cached input,
 * cache write, output) a token falls under is something only the server sees,
 * and the rate card itself moves with the model — so the price table lives
 * next to the model config in `server/src/config/aiPricing.ts` and this card
 * renders what it is told.
 */
export function AiUsageCard() {
  const { t } = useI18n()
  const [days, setDays] = useState<number>(7)
  const [usage, setUsage] = useState<UsageState | null>(null)

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
  const rates = data?.rates

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
        <Stat
          label={t('home.usageInput')}
          value={format(totals?.promptTokens)}
          // Cached tokens are part of the input figure above, not a fifth
          // column beside it — billed at a tenth of the rate, hence the note.
          hint={
            totals ? t('home.usageCached', { tokens: format(totals.cachedTokens) }) : null
          }
        />
        <Stat label={t('home.usageOutput')} value={format(totals?.completionTokens)} />
        <Stat
          accent
          label={t('home.usageCost')}
          value={totals ? `$${totals.costUsd.toFixed(4)}` : '—'}
        />
      </Card.Content>

      <Card.Footer className="flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        {usage?.status === 'error' ? (
          <span className="text-danger">{t('home.usageError')}</span>
        ) : (
          <>
            {rates ? (
              <span>
                {t('home.usageRates', {
                  input: RATE_FORMAT.format(rates.input),
                  cached: RATE_FORMAT.format(rates.cachedInput),
                  output: RATE_FORMAT.format(rates.output),
                })}
              </span>
            ) : null}
            {totals && totals.unpricedCalls > 0 ? (
              <span className="text-warning-soft-foreground">
                {t('home.usageUnpriced', { count: totals.unpricedCalls })}
              </span>
            ) : null}
          </>
        )}
      </Card.Footer>
    </Card>
  )
}
