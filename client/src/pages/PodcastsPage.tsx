import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Input, message, Modal, Select } from 'antd'
import {
  deletePodcast,
  importPodcast,
  inspectYoutubeUrl,
  listPodcasts,
} from '../api/podcasts'
import { getErrorMessage } from '../api/error'
import type { PodcastSummary, YoutubeInspectResult } from '../types'

function formatDuration(sec: number) {
  if (!sec) return '—'
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

// Group podcasts by relative date, YouTube-history-style. "今天" / "昨天" /
// 周内显示星期几 / 更久显示完整日期。返回数组保序方便渲染。
function groupByDate(items: PodcastSummary[]): Array<{
  label: string
  items: PodcastSummary[]
}> {
  if (items.length === 0) return []
  const now = new Date()
  const startOf = (d: Date) => {
    const x = new Date(d)
    x.setHours(0, 0, 0, 0)
    return x.getTime()
  }
  const todayStart = startOf(now)
  const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']
  const labelFor = (d: Date) => {
    const dayStart = startOf(d)
    const diffDays = Math.round((todayStart - dayStart) / 86_400_000)
    if (diffDays === 0) return '今天'
    if (diffDays === 1) return '昨天'
    if (diffDays > 1 && diffDays < 7) return weekdays[d.getDay()]
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate(),
    ).padStart(2, '0')}`
  }
  // Sort desc by "last touched" — updatedAt is bumped every time playback
  // saves position, so this matches YouTube history's "what I last watched".
  // Fall back to createdAt for older rows that predate updatedAt.
  const pickStamp = (p: PodcastSummary) =>
    new Date(p.updatedAt ?? p.createdAt ?? 0).getTime()
  const sorted = [...items].sort((a, b) => pickStamp(b) - pickStamp(a))
  const groups: Array<{ label: string; items: PodcastSummary[] }> = []
  let current: { label: string; items: PodcastSummary[] } | null = null
  for (const item of sorted) {
    const d = new Date(item.updatedAt ?? item.createdAt ?? 0)
    const label = labelFor(d)
    if (!current || current.label !== label) {
      current = { label, items: [] }
      groups.push(current)
    }
    current.items.push(item)
  }
  return groups
}

export function PodcastsPage() {
  const navigate = useNavigate()
  const [list, setList] = useState<PodcastSummary[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [url, setUrl] = useState('')
  const [primaryLang, setPrimaryLang] = useState<'jp' | 'en'>('jp')
  const [isInspecting, setIsInspecting] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [inspect, setInspect] = useState<YoutubeInspectResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [primarySrt, setPrimarySrt] = useState('')
  const [zhSrt, setZhSrt] = useState('')

  const groups = useMemo(() => groupByDate(list), [list])

  const load = async () => {
    setIsLoading(true)
    try {
      const rows = await listPodcasts()
      setList(rows)
    } catch (err) {
      setError(getErrorMessage(err, '加载播客列表失败'))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const handleInspect = async () => {
    if (!url.trim()) return
    setIsInspecting(true)
    setError(null)
    setInspect(null)
    try {
      const r = await inspectYoutubeUrl(url.trim())
      setInspect(r)
      // Default primary lang to whatever the video has natively if obvious.
      const langs = new Set(r.captionTracks.map((t) => t.languageCode.toLowerCase().split('-')[0]))
      if (langs.has('ja')) setPrimaryLang('jp')
      else if (langs.has('en')) setPrimaryLang('en')
    } catch (err) {
      setError(getErrorMessage(err, '抓取视频信息失败'))
    } finally {
      setIsInspecting(false)
    }
  }

  const handleImport = async () => {
    if (!url.trim()) return
    setIsImporting(true)
    setError(null)
    try {
      const created = await importPodcast({
        url: url.trim(),
        primaryLang,
        primarySrt: primarySrt.trim() || undefined,
        zhSrt: zhSrt.trim() || undefined,
      })
      message.success('导入成功')
      setUrl('')
      setInspect(null)
      setPrimarySrt('')
      setZhSrt('')
      await load()
      navigate(`/podcasts/${created.id}`)
    } catch (err) {
      setError(getErrorMessage(err, '导入失败'))
    } finally {
      setIsImporting(false)
    }
  }

  const handleSrtFile = async (
    e: React.ChangeEvent<HTMLInputElement>,
    setter: (s: string) => void,
  ) => {
    const file = e.target.files?.[0]
    if (!file) return
    const text = await file.text()
    setter(text)
    // Reset input so picking the same file again still fires change.
    e.target.value = ''
  }

  const handleDelete = async (id: string, title: string) => {
    Modal.confirm({
      title: `删除「${title}」?`,
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await deletePodcast(id)
          await load()
        } catch (err) {
          message.error(getErrorMessage(err, '删除失败'))
        }
      },
    })
  }

  return (
    <section className="page">
      <div className="section-header">
        <div>
          <p className="eyebrow">Podcasts</p>
          <h2>播客 / 视频</h2>
          <p className="muted">粘贴 YouTube 链接,导入字幕逐句精听。共 {list.length} 个</p>
        </div>
      </div>

      <div className="card">
        <label style={{ display: 'block' }}>
          <span className="muted">YouTube 链接</span>
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.youtube.com/watch?v=..."
          />
        </label>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
          <label className="lang-picker">
            <span className="muted">主要语言</span>
            <Select
              value={primaryLang}
              onChange={(v) => setPrimaryLang(v)}
              style={{ minWidth: 90 }}
              options={[
                { value: 'jp', label: '日语' },
                { value: 'en', label: '英语' },
              ]}
            />
          </label>
          <button
            type="button"
            onClick={() => void handleInspect()}
            disabled={isInspecting || !url.trim()}
          >
            {isInspecting ? '抓取中...' : '预览字幕'}
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={() => void handleImport()}
            disabled={isImporting || !url.trim()}
          >
            {isImporting ? '导入中...' : '导入'}
          </button>
        </div>

        <details style={{ marginTop: 12 }}>
          <summary className="muted" style={{ cursor: 'pointer' }}>
            手动上传字幕(YouTube 抓不到时用)
          </summary>
          <div style={{ marginTop: 10, display: 'grid', gap: 12 }}>
            <label style={{ display: 'grid', gap: 4 }}>
              <span className="muted">
                主要语言字幕(.srt / .vtt)
                <input
                  type="file"
                  accept=".srt,.vtt,text/plain"
                  onChange={(e) => void handleSrtFile(e, setPrimarySrt)}
                  style={{ marginLeft: 8 }}
                />
              </span>
              <Input.TextArea
                rows={4}
                value={primarySrt}
                onChange={(e) => setPrimarySrt(e.target.value)}
                placeholder="把 .srt 或 .vtt 文件内容粘到这里"
                style={{ fontFamily: 'monospace', fontSize: 12 }}
              />
            </label>
            <label style={{ display: 'grid', gap: 4 }}>
              <span className="muted">
                中文字幕(可选)
                <input
                  type="file"
                  accept=".srt,.vtt,text/plain"
                  onChange={(e) => void handleSrtFile(e, setZhSrt)}
                  style={{ marginLeft: 8 }}
                />
              </span>
              <Input.TextArea
                rows={4}
                value={zhSrt}
                onChange={(e) => setZhSrt(e.target.value)}
                placeholder="如有中文字幕也粘进来,按时间区间对齐到主语言行"
                style={{ fontFamily: 'monospace', fontSize: 12 }}
              />
            </label>
            <p className="muted" style={{ margin: 0, fontSize: 12 }}>
              填了主要语言字幕,导入时就不再向 YouTube 拉字幕;留空则走自动抓取。
            </p>
          </div>
        </details>
        {error ? <p className="error-text" style={{ marginTop: 10 }}>{error}</p> : null}
        {inspect ? (
          <div className="card" style={{ marginTop: 12, background: 'rgba(15,23,42,0.03)' }}>
            <strong>{inspect.title}</strong>
            <p className="muted" style={{ margin: '4px 0' }}>时长 {formatDuration(inspect.durationSec)}</p>
            <p className="muted" style={{ margin: '4px 0' }}>
              可用字幕: {inspect.captionTracks.length} 个
            </p>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
              {inspect.captionTracks.map((t) => (
                <li key={t.languageCode}>
                  {t.name} · <span className="muted">{t.languageCode}</span>
                  {t.kind === 'asr' ? <span className="muted"> · 自动生成</span> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      {isLoading ? <div className="card">加载中...</div> : null}

      <div className="podcast-history">
        {groups.map((group) => (
          <section key={group.label} className="podcast-history-group">
            <h3 className="podcast-history-day">{group.label}</h3>
            <ul className="podcast-history-list">
              {group.items.map((p) => {
                const progress =
                  p.durationSec > 0 && (p.lastPositionSec ?? 0) > 0
                    ? Math.min(100, ((p.lastPositionSec ?? 0) / p.durationSec) * 100)
                    : 0
                return (
                  <li key={p.id} className="podcast-history-item">
                    <Link className="podcast-history-thumb-link" to={`/podcasts/${p.id}`}>
                      <div className="podcast-history-thumb">
                        {p.thumbnail ? (
                          <img src={p.thumbnail} alt="" loading="lazy" />
                        ) : (
                          <div className="podcast-history-thumb-empty" />
                        )}
                        <span className="podcast-history-duration">
                          {formatDuration(p.durationSec)}
                        </span>
                        {progress > 0 ? (
                          <span
                            className="podcast-history-progress"
                            style={{ width: `${progress}%` }}
                          />
                        ) : null}
                      </div>
                    </Link>
                    <div className="podcast-history-meta">
                      <Link
                        className="podcast-history-title"
                        to={`/podcasts/${p.id}`}
                      >
                        {p.title}
                      </Link>
                      <p className="podcast-history-sub muted">
                        {p.primaryLang.toUpperCase()}
                        {progress > 0 ? (
                          <>
                            <span className="podcast-history-dot">·</span>
                            已看 {Math.round(progress)}%
                          </>
                        ) : null}
                      </p>
                      <button
                        type="button"
                        className="ghost-button podcast-history-delete"
                        onClick={() => void handleDelete(p.id, p.title)}
                      >
                        删除
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
      </div>
    </section>
  )
}
