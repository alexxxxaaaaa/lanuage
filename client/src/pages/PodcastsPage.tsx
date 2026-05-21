import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { message, Modal } from 'antd'
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
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.youtube.com/watch?v=..."
            style={{ width: '100%' }}
          />
        </label>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
          <label className="lang-picker">
            <span className="muted">主要语言</span>
            <select
              value={primaryLang}
              onChange={(e) => setPrimaryLang(e.target.value as 'jp' | 'en')}
            >
              <option value="jp">日语</option>
              <option value="en">英语</option>
            </select>
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
              <textarea
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
              <textarea
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

      <div className="folder-grid podcast-grid">
        {list.map((p) => (
          <article key={p.id} className="card folder-card">
            <Link className="folder-card-link" to={`/podcasts/${p.id}`}>
              {p.thumbnail ? (
                <img
                  src={p.thumbnail}
                  alt=""
                  style={{ width: '100%', borderRadius: 12, marginBottom: 10 }}
                  loading="lazy"
                />
              ) : null}
              <div className="folder-top">
                <strong>{p.title}</strong>
                <span className="folder-language">{p.primaryLang.toUpperCase()}</span>
              </div>
              <p className="muted">时长 {formatDuration(p.durationSec)}</p>
            </Link>
            <div className="folder-card-actions">
              <button
                type="button"
                className="ghost-button danger"
                onClick={() => void handleDelete(p.id, p.title)}
              >
                删除
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
