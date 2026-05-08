import { useEffect, useState } from 'react'
import { getAiUsage, type AiUsageSummary } from '../api/ai'

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

export function AiUsagePage() {
  const [days, setDays] = useState(7)
  const [data, setData] = useState<AiUsageSummary | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pricePerMillionTokens, setPricePerMillionTokens] = useState(2)

  const load = async (nextDays: number) => {
    setIsLoading(true)
    setError(null)
    try {
      const result = await getAiUsage(nextDays)
      setData(result)
    } catch {
      setError('加载 AI 用量失败')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void load(days)
  }, [days])

  const estimatedCost =
    ((data?.totals.totalTokens ?? 0) / 1_000_000) * pricePerMillionTokens

  return (
    <section className="page">
      <div className="section-header">
        <div>
          <p className="eyebrow">AI Usage</p>
          <h2>AI 使用量</h2>
          <p className="muted">模型：{data?.model ?? 'gpt-4.1-mini'}</p>
        </div>
        <label className="session-inline">
          <span>统计周期</span>
          <select value={days} onChange={(event) => setDays(Number(event.target.value))}>
            <option value={7}>近 7 天</option>
            <option value={30}>近 30 天</option>
            <option value={90}>近 90 天</option>
          </select>
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
                <input
                  type="number"
                  min={0}
                  step="0.1"
                  value={pricePerMillionTokens}
                  onChange={(event) => {
                    const next = Number(event.target.value)
                    setPricePerMillionTokens(Number.isFinite(next) && next >= 0 ? next : 0)
                  }}
                  style={{ width: 120 }}
                />
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
