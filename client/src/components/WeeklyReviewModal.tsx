import { useEffect, useState } from 'react'
import { ProgressBar, Spinner } from '@heroui/react'
import { Modal } from './ui/Modal'
import { getWeeklyReview, type WeeklyReviewSummary } from '../api/weeklyReview'
import { getErrorMessage } from '../api/error'

type Props = {
  open: boolean
  onClose: () => void
}

function formatShortDate(iso: string) {
  const d = new Date(iso)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${m}/${day}`
}

function rateColor(rate: number) {
  if (rate >= 80) return 'success' as const
  if (rate >= 60) return 'warning' as const
  return 'danger' as const
}

// Little inline bar chart of per-day activity. Nothing fancy — just relative
// heights so the user can see which days were active without looking at raw
// numbers. 7 columns; each track stacks word events under grammar events.
function DailyBars({ data }: { data: WeeklyReviewSummary['perDay'] }) {
  const max = Math.max(1, ...data.map((d) => d.wordEvents + d.grammarEvents))
  const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']
  return (
    <div className="mt-1 grid h-30 grid-cols-7 items-end gap-2">
      {data.map((d) => {
        const total = d.wordEvents + d.grammarEvents
        const dt = new Date(d.date)
        const label = WEEKDAYS[dt.getDay()]
        return (
          <div key={d.date} className="flex h-full flex-col items-center gap-1">
            <div className="flex w-full flex-1 flex-col-reverse overflow-hidden rounded bg-foreground/5">
              <div
                className="bg-indigo-500 transition-[height] duration-150"
                style={{ height: `${(d.wordEvents / max) * 100}%` }}
                title={`词 ${d.wordEvents}`}
              />
              <div
                className="bg-emerald-500 transition-[height] duration-150"
                style={{ height: `${(d.grammarEvents / max) * 100}%` }}
                title={`语法 ${d.grammarEvents}`}
              />
            </div>
            <div className="text-[11px] text-muted">{label}</div>
            <div className="min-h-3.5 text-[10px] tabular-nums text-foreground">
              {total > 0 ? total : ''}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function Section({
  title,
  meta,
  children,
}: {
  title: string
  meta: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="grid gap-2">
      <header className="flex items-baseline justify-between gap-2">
        <strong className="text-sm text-foreground">{title}</strong>
        <span className="text-xs text-muted">{meta}</span>
      </header>
      {children}
    </section>
  )
}

function CorrectRate({ rate }: { rate: number }) {
  return (
    <ProgressBar
      aria-label="正确率"
      color={rateColor(rate)}
      value={rate}
      valueLabel={`${rate}% 正确`}
    >
      <ProgressBar.Output className="text-xs tabular-nums text-muted" />
      <ProgressBar.Track>
        <ProgressBar.Fill />
      </ProgressBar.Track>
    </ProgressBar>
  )
}

export function WeeklyReviewModal({ open, onClose }: Props) {
  const [data, setData] = useState<WeeklyReviewSummary | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setIsLoading(true)
    setError(null)
    getWeeklyReview()
      .then((r) => setData(r))
      .catch((e) => setError(getErrorMessage(e, '加载失败')))
      .finally(() => setIsLoading(false))
  }, [open])

  return (
    <Modal isOpen={open} size="lg" title="本周回顾" onClose={onClose}>
      {isLoading ? (
        <div className="flex justify-center p-10">
          <Spinner />
        </div>
      ) : error ? (
        <p className="muted">{error}</p>
      ) : data ? (
        <div className="grid gap-5">
          <p className="m-0 text-xs text-muted">
            {formatShortDate(data.windowStart)} – {formatShortDate(data.windowEnd)}
          </p>

          <Section
            meta={`新学 ${data.words.learned} · 复习 ${data.words.reviewed} 次`}
            title="单词"
          >
            {data.words.reviewed > 0 ? (
              <CorrectRate rate={data.words.correctRate} />
            ) : (
              <p className="m-0 text-muted">还没复习过</p>
            )}
          </Section>

          <Section
            meta={`新学 ${data.grammars.learned} · 复习 ${data.grammars.reviewed} 次`}
            title="语法"
          >
            {data.grammars.reviewed > 0 ? (
              <CorrectRate rate={data.grammars.correctRate} />
            ) : (
              <p className="m-0 text-muted">还没复习过</p>
            )}
          </Section>

          <Section meta={`听/看了 ${data.podcasts.touched} 期`} title="播客">
            {data.podcasts.titles.length > 0 ? (
              <ul className="m-0 grid list-inside list-disc gap-0.5 p-0 text-[13px]">
                {data.podcasts.titles.map((t) => (
                  <li key={t} className="text-muted">
                    {t}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="m-0 text-muted">本周没听过播客</p>
            )}
          </Section>

          <Section
            meta={
              <>
                <span className="mr-1 ml-2 inline-block size-2 rounded-full bg-indigo-500 align-middle" />
                单词
                <span className="mr-1 ml-2 inline-block size-2 rounded-full bg-emerald-500 align-middle" />
                语法
              </>
            }
            title="每日活动"
          >
            <DailyBars data={data.perDay} />
          </Section>
        </div>
      ) : null}
    </Modal>
  )
}
