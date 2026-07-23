import { useEffect, useState } from 'react'
import { Modal, Progress, Spin } from 'antd'
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

// Little inline bar chart of per-day activity. Nothing fancy — just relative
// heights so the user can see which days were active without looking at raw
// numbers.
function DailyBars({ data }: { data: WeeklyReviewSummary['perDay'] }) {
  const max = Math.max(
    1,
    ...data.map((d) => d.wordEvents + d.grammarEvents),
  )
  const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']
  return (
    <div className="weekly-review-bars">
      {data.map((d) => {
        const total = d.wordEvents + d.grammarEvents
        const dt = new Date(d.date)
        const label = WEEKDAYS[dt.getDay()]
        return (
          <div key={d.date} className="weekly-review-bar-col">
            <div className="weekly-review-bar-track">
              <div
                className="weekly-review-bar-word"
                style={{
                  height: `${(d.wordEvents / max) * 100}%`,
                }}
                title={`词 ${d.wordEvents}`}
              />
              <div
                className="weekly-review-bar-grammar"
                style={{
                  height: `${(d.grammarEvents / max) * 100}%`,
                }}
                title={`语法 ${d.grammarEvents}`}
              />
            </div>
            <div className="weekly-review-bar-label">{label}</div>
            <div className="weekly-review-bar-total">{total > 0 ? total : ''}</div>
          </div>
        )
      })}
    </div>
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
    <Modal
      title="本周回顾"
      open={open}
      onCancel={onClose}
      footer={null}
      width={560}
    >
      {isLoading ? (
        <div style={{ padding: 40, textAlign: 'center' }}>
          <Spin />
        </div>
      ) : error ? (
        <p className="muted">{error}</p>
      ) : data ? (
        <div className="weekly-review-body">
          <p className="muted weekly-review-window">
            {formatShortDate(data.windowStart)} – {formatShortDate(data.windowEnd)}
          </p>

          <section className="weekly-review-section">
            <header className="weekly-review-section-header">
              <strong>单词</strong>
              <span className="muted">
                新学 {data.words.learned} · 复习 {data.words.reviewed} 次
              </span>
            </header>
            {data.words.reviewed > 0 ? (
              <Progress
                percent={data.words.correctRate}
                strokeColor={
                  data.words.correctRate >= 80
                    ? '#22c55e'
                    : data.words.correctRate >= 60
                      ? '#f59e0b'
                      : '#ef4444'
                }
                format={(p) => `${p}% 正确`}
              />
            ) : (
              <p className="muted" style={{ margin: 0 }}>还没复习过</p>
            )}
          </section>

          <section className="weekly-review-section">
            <header className="weekly-review-section-header">
              <strong>语法</strong>
              <span className="muted">
                新学 {data.grammars.learned} · 复习 {data.grammars.reviewed} 次
              </span>
            </header>
            {data.grammars.reviewed > 0 ? (
              <Progress
                percent={data.grammars.correctRate}
                strokeColor={
                  data.grammars.correctRate >= 80
                    ? '#22c55e'
                    : data.grammars.correctRate >= 60
                      ? '#f59e0b'
                      : '#ef4444'
                }
                format={(p) => `${p}% 正确`}
              />
            ) : (
              <p className="muted" style={{ margin: 0 }}>还没复习过</p>
            )}
          </section>

          <section className="weekly-review-section">
            <header className="weekly-review-section-header">
              <strong>播客</strong>
              <span className="muted">
                听/看了 {data.podcasts.touched} 期
              </span>
            </header>
            {data.podcasts.titles.length > 0 ? (
              <ul className="weekly-review-podcast-list">
                {data.podcasts.titles.map((t) => (
                  <li key={t} className="muted">{t}</li>
                ))}
              </ul>
            ) : (
              <p className="muted" style={{ margin: 0 }}>本周没听过播客</p>
            )}
          </section>

          <section className="weekly-review-section">
            <header className="weekly-review-section-header">
              <strong>每日活动</strong>
              <span className="muted">
                <span className="weekly-review-legend-dot dot-word" /> 单词
                <span className="weekly-review-legend-dot dot-grammar" /> 语法
              </span>
            </header>
            <DailyBars data={data.perDay} />
          </section>
        </div>
      ) : null}
    </Modal>
  )
}
