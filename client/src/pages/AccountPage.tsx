import { Avatar, Button, NumberField } from '@heroui/react'
import { LogOut } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'

import { getAiUsage, type AiUsageSummary } from '../api/ai'
import { SelectField } from '../components/ui/SelectField'
import { useI18n } from '../i18n'
import { useAuthStore } from '../store/authStore'

const FEATURE_LABELS: Record<string, string> = {
  word_fill: '单词 AI 填充',
  word_quiz: '单词随堂题',
  expression_casual: '表达 AI 生成',
  expression_translate: '表达翻成中文',
  other: '其他',
}

function formatFeature(feature: string) {
  return FEATURE_LABELS[feature] ?? feature
}

/** The period each result belongs to, so a stale one reads as "still loading". */
type UsageState =
  | { status: 'ok'; days: number; data: AiUsageSummary }
  | { status: 'error'; days: number }

/**
 * Everything about the signed-in user in one page: identity, sign out, and the
 * AI usage report that used to live at its own `/ai-usage` route.
 */
export function AccountPage() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const [days, setDays] = useState(7)
  const [usage, setUsage] = useState<UsageState | null>(null)
  const [pricePerMillionTokens, setPricePerMillionTokens] = useState(2)

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
  const error = usage?.status === 'error' ? '加载 AI 用量失败' : null

  const estimatedCost =
    ((data?.totals.totalTokens ?? 0) / 1_000_000) * pricePerMillionTokens

  const displayName = user?.username || '—'
  const initials = displayName.slice(0, 2).toUpperCase()

  return (
    <section className="page">
      <div>
        <p className="eyebrow">Account</p>
        <h2>{t('routes.account')}</h2>
      </div>

      <article className="card flex flex-wrap items-center gap-4">
        <Avatar size="lg">
          <Avatar.Fallback>{initials}</Avatar.Fallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg leading-6 font-semibold">{displayName}</p>
          <p className="mt-1 truncate text-sm text-muted">Word Sprint</p>
        </div>
        <Button
          variant="danger-soft"
          onPress={() => {
            useAuthStore.getState().clearSession()
            navigate('/login', { replace: true })
          }}
        >
          <LogOut className="size-4" aria-hidden />
          {t('auth.logout')}
        </Button>
      </article>

      <div className="section-header">
        <div>
          <p className="eyebrow">AI Usage</p>
          <h3>AI 使用量</h3>
          <p className="muted">模型：{data?.model ?? 'gpt-4.1-mini'}</p>
        </div>
        <label className="session-inline">
          <span>统计周期</span>
          <SelectField
            value={days}
            onChange={(v) => setDays(v)}
            className="min-w-[120px]"
            options={[
              { value: 7, label: '近 7 天' },
              { value: 30, label: '近 30 天' },
              { value: 90, label: '近 90 天' },
            ]}
          />
        </label>
      </div>

      {isLoading ? <div className="card">加载中...</div> : null}
      {error ? <p className="error-text">{error}</p> : null}

      {data ? (
        <>
          <div className="folder-grid">
            <article className="card folder-card">
              <strong>总调用次数</strong>
              <p className="hero-count" style={{ fontSize: 36 }}>{data.totals.calls}</p>
            </article>
            <article className="card folder-card">
              <strong>总 Token</strong>
              <p className="hero-count" style={{ fontSize: 36 }}>{data.totals.totalTokens}</p>
              <p className="muted">输入 {data.totals.promptTokens} / 输出 {data.totals.completionTokens}</p>
            </article>
            <article className="card folder-card">
              <strong>估算费用（USD）</strong>
              <p className="hero-count" style={{ fontSize: 36 }}>${estimatedCost.toFixed(4)}</p>
              <label className="session-inline" style={{ justifyContent: 'space-between' }}>
                <span className="muted">单价 ($ / 1M tokens)</span>
                <NumberField
                  aria-label="单价 ($ / 1M tokens)"
                  className="w-[140px]"
                  minValue={0}
                  step={0.1}
                  value={pricePerMillionTokens}
                  onChange={(next) => {
                    setPricePerMillionTokens(Number.isFinite(next) && next >= 0 ? next : 0)
                  }}
                >
                  <NumberField.Group>
                    <NumberField.DecrementButton />
                    <NumberField.Input />
                    <NumberField.IncrementButton />
                  </NumberField.Group>
                </NumberField>
              </label>
            </article>
          </div>

          <article className="card">
            <h3>按功能拆分</h3>
            {(data.byFeature ?? []).length === 0 ? (
              <p className="muted">暂无数据</p>
            ) : (
              <div className="word-list">
                {(data.byFeature ?? []).map((item) => {
                  const total = data.totals.totalTokens || 1
                  const percent = Math.round((item.totalTokens / total) * 100)
                  return (
                    <div key={item.feature} className="folder-top">
                      <span>
                        <strong>{formatFeature(item.feature)}</strong>
                        <span className="muted">（{item.calls} 次）</span>
                      </span>
                      <span className="muted">
                        {item.totalTokens} tokens · {percent}%
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </article>

          <article className="card">
            <h3>每日用量</h3>
            {data.byDay.length === 0 ? (
              <p className="muted">暂无数据</p>
            ) : (
              <div className="word-list">
                {data.byDay.map((item) => (
                  <div key={item.date} className="folder-top">
                    <strong>{item.date}</strong>
                    <span className="muted">调用 {item.calls} 次 · {item.totalTokens} tokens</span>
                  </div>
                ))}
              </div>
            )}
          </article>

          <article className="card">
            <h3>最近调用</h3>
            {data.logs.length === 0 ? (
              <p className="muted">暂无数据</p>
            ) : (
              <div className="word-list">
                {data.logs.slice(0, 30).map((log) => (
                  <div key={log.id} className="folder-top">
                    <span>
                      <strong>{log.word}</strong>{' '}
                      <span className="muted">
                        ({log.language.toUpperCase()} · {formatFeature(log.feature)})
                      </span>
                    </span>
                    <span className="muted">{log.totalTokens} tokens</span>
                  </div>
                ))}
              </div>
            )}
          </article>
        </>
      ) : null}
    </section>
  )
}
