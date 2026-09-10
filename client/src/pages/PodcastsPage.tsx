import { useEffect, useMemo, useState } from 'react'
import { Button } from '@heroui/react'
import { Modal } from '../components/ui/Modal'
import { SelectField } from '../components/ui/SelectField'
import { Input, TextArea, toast } from '@heroui/react'
import { confirm } from '../components/ui/dialog'
import { Link, useNavigate } from 'react-router'
import {
  deletePodcast,
  importMp3Podcast,
  importPodcast,
  inspectYoutubeUrl,
  listPodcasts,
  updatePodcastMeta,
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
//
// 形状和 groupBySeries 对齐（同一个 SeriesGroup），这样渲染那边只有一份代码；
// 按时间分出来的组不是「套」，所以 loose 恒为 true，不显示场次进度。
function groupByDate(items: PodcastSummary[]): SeriesGroup[] {
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
  const groups: SeriesGroup[] = []
  let current: SeriesGroup | null = null
  for (const item of sorted) {
    const d = new Date(item.updatedAt ?? item.createdAt ?? 0)
    const label = labelFor(d)
    if (!current || current.label !== label) {
      current = { key: label, label, items: [], loose: true }
      groups.push(current)
    }
    current.items.push(item)
  }
  return groups
}

/** 一场听完的判定。播放器很难正好停在 100%（片尾音乐、提前关页面），
 *  卡在 97% 也该算听完了。 */
const DONE_RATIO = 0.95

function isFinished(p: PodcastSummary) {
  if (!p.durationSec) return false
  return (p.lastPositionSec ?? 0) / p.durationSec >= DONE_RATIO
}

type SeriesGroup = {
  key: string
  label: string
  items: PodcastSummary[]
  /** 未归类那组：不算「套」，不显示场次进度。 */
  loose: boolean
}

/**
 * 按「套」分组：同一 (级别, 年) 的几场真题算一套，组内按月份排（7 月在前）。
 * 年份缺失的一律归到「未归类」——英语播客、随手导的视频、YouTube 元数据没
 * 抓到导致标题还是 videoId 的，都落在这里等着手动归类。
 */
function groupBySeries(items: PodcastSummary[]): SeriesGroup[] {
  const sets = new Map<string, SeriesGroup>()
  const loose: PodcastSummary[] = []

  for (const p of items) {
    const year = p.examYear ?? 0
    if (!year) {
      loose.push(p)
      continue
    }
    const level = p.examLevel ?? ''
    const key = `${level}|${year}`
    let group = sets.get(key)
    if (!group) {
      group = {
        key,
        label: level ? `${level} · ${year}年` : `${year}年`,
        items: [],
        loose: false,
      }
      sets.set(key, group)
    }
    group.items.push(p)
  }

  const ordered = [...sets.values()].sort((a, b) => {
    const [aLevel, aYear] = a.key.split('|')
    const [bLevel, bYear] = b.key.split('|')
    // 年份新的在前；同年按级别排（N1 在 N5 前面）。
    if (aYear !== bYear) return Number(bYear) - Number(aYear)
    return aLevel.localeCompare(bLevel)
  })

  for (const group of ordered) {
    group.items.sort((a, b) => {
      const am = a.examMonth ?? 0
      const bm = b.examMonth ?? 0
      if (am !== bm) return am - bm
      return (a.title ?? '').localeCompare(b.title ?? '')
    })
  }

  if (loose.length > 0) {
    // 未归类里保持「最近看过」的顺序，和按时间视图一致。
    loose.sort(
      (a, b) =>
        new Date(b.updatedAt ?? b.createdAt ?? 0).getTime() -
        new Date(a.updatedAt ?? a.createdAt ?? 0).getTime(),
    )
    ordered.push({ key: '__loose__', label: '未归类', items: loose, loose: true })
  }

  return ordered
}

const LEVEL_OPTIONS = [
  { value: '', label: '未归类' },
  ...['N1', 'N2', 'N3', 'N4', 'N5'].map((v) => ({ value: v, label: v })),
]

// JLPT 一年只考两场，所以月份是个选项而不是自由输入。
const MONTH_OPTIONS = [
  { value: '0', label: '未归类' },
  { value: '7', label: '7月' },
  { value: '12', label: '12月' },
]

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

  // MP3 import modal state — separate from YouTube flow.
  const [mp3ModalOpen, setMp3ModalOpen] = useState(false)
  const [mp3Title, setMp3Title] = useState('')
  const [mp3Url, setMp3Url] = useState('')
  const [mp3Lang, setMp3Lang] = useState<'jp' | 'en'>('jp')
  const [mp3PrimarySrt, setMp3PrimarySrt] = useState('')
  const [mp3ZhSrt, setMp3ZhSrt] = useState('')
  const [isMp3Importing, setIsMp3Importing] = useState(false)

  const handleMp3Import = async () => {
    const title = mp3Title.trim()
    const url = mp3Url.trim()
    const srt = mp3PrimarySrt.trim()
    if (!title || !url || !srt) {
      toast.warning('标题、mp3 路径、字幕内容都要填')
      return
    }
    setIsMp3Importing(true)
    try {
      await importMp3Podcast({
        title,
        mp3Url: url,
        primaryLang: mp3Lang,
        primarySrt: srt,
        zhSrt: mp3ZhSrt.trim() || undefined,
      })
      toast.success('MP3 播客导入成功')
      setMp3ModalOpen(false)
      setMp3Title('')
      setMp3Url('')
      setMp3PrimarySrt('')
      setMp3ZhSrt('')
      await load()
    } catch (err) {
      toast.danger(getErrorMessage(err, '导入失败'))
    } finally {
      setIsMp3Importing(false)
    }
  }

  const handleMp3SrtFile = (
    e: React.ChangeEvent<HTMLInputElement>,
    setter: (v: string) => void,
  ) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setter(String(reader.result ?? ''))
    reader.readAsText(file)
    e.target.value = ''
  }

  // 归类编辑弹框——标题和级别/年/月一起改。
  const [editing, setEditing] = useState<PodcastSummary | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editLevel, setEditLevel] = useState('')
  const [editYear, setEditYear] = useState('')
  const [editMonth, setEditMonth] = useState('0')
  const [isSavingMeta, setIsSavingMeta] = useState(false)

  const [viewMode, setViewMode] = useState<'series' | 'time'>('series')

  const openEdit = (p: PodcastSummary) => {
    setEditing(p)
    setEditTitle(p.title)
    setEditLevel(p.examLevel ?? '')
    setEditYear(p.examYear ? String(p.examYear) : '')
    setEditMonth(String(p.examMonth ?? 0))
  }

  const handleSaveMeta = async () => {
    if (!editing) return
    const title = editTitle.trim()
    if (!title) {
      toast.warning('标题不能为空')
      return
    }
    setIsSavingMeta(true)
    try {
      await updatePodcastMeta(editing.id, {
        title,
        examLevel: editLevel,
        examYear: Number(editYear) || 0,
        examMonth: Number(editMonth) || 0,
      })
      toast.success('已保存')
      setEditing(null)
      await load()
    } catch (err) {
      toast.danger(getErrorMessage(err, '保存失败'))
    } finally {
      setIsSavingMeta(false)
    }
  }

  const groups = useMemo(() => groupByDate(list), [list])
  const seriesGroups = useMemo(() => groupBySeries(list), [list])

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
      toast.success('导入成功')
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
    const ok = await confirm({
      title: `删除「${title}」?`,
      okText: '删除',
      cancelText: '取消',
      status: 'danger',
    })
    if (!ok) return
    try {
      await deletePodcast(id)
      await load()
    } catch (err) {
      toast.danger(getErrorMessage(err, '删除失败'))
    }
  }

  // 两个视图共用一张卡。`inSeries` 时多显示一个月份角标 —— 组头已经写了
  // 级别和年份，卡上只差「这是哪一场」。
  const renderCard = (p: PodcastSummary, inSeries: boolean) => {
    const progress =
      p.durationSec > 0 && (p.lastPositionSec ?? 0) > 0
        ? Math.min(100, ((p.lastPositionSec ?? 0) / p.durationSec) * 100)
        : 0
    const done = isFinished(p)
    return (
      <li
        key={p.id}
        className="grid grid-cols-[240px_1fr] items-start gap-4 rounded-xl bg-surface p-3 shadow-card transition-shadow duration-150 hover:shadow-overlay max-sm:grid-cols-[160px_1fr] max-sm:gap-3"
      >
        <Link className="block no-underline" to={`/podcasts/${p.id}`}>
          <div className="relative aspect-video w-full overflow-hidden rounded-[10px] bg-surface-tertiary">
            {p.thumbnail ? (
              <img
                className="block size-full object-cover"
                src={p.thumbnail}
                alt=""
                loading="lazy"
              />
            ) : (
              <div className="size-full" />
            )}
            <span className="absolute right-1.5 bottom-1.5 rounded px-1.5 py-0.5 text-xs tracking-[0.02em] text-white bg-black/78">
              {formatDuration(p.durationSec)}
            </span>
            {progress > 0 ? (
              <span
                className="absolute bottom-0 left-0 h-[3px] bg-accent"
                style={{ width: `${progress}%` }}
              />
            ) : null}
          </div>
        </Link>
        <div className="flex min-w-0 flex-col gap-1">
          <Link
            className="line-clamp-2 text-base/[1.4] font-semibold text-foreground no-underline hover:text-accent max-sm:text-[15px]"
            to={`/podcasts/${p.id}`}
          >
            {inSeries && p.examMonth ? (
              <span className="mr-2 rounded bg-surface-tertiary px-1.5 py-0.5 align-middle text-xs font-medium">
                {p.examMonth}月
              </span>
            ) : null}
            {p.title}
          </Link>
          <p className="muted m-0 flex items-center gap-1.5 text-[13px]">
            {p.primaryLang.toUpperCase()}
            {progress > 0 ? (
              <>
                <span className="opacity-60">·</span>
                {done ? '已听完' : `已看 ${Math.round(progress)}%`}
              </>
            ) : null}
          </p>
          <div className="mt-1 flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="self-start text-xs"
              type="button"
              onPress={() => openEdit(p)}
            >
              编辑
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="self-start text-xs"
              type="button"
              onPress={() => void handleDelete(p.id, p.title)}
            >
              删除
            </Button>
          </div>
        </div>
      </li>
    )
  }

  return (
    <section className="page">
      <div className="section-header">
        <div>
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
            <SelectField
              value={primaryLang}
              onChange={(v) => setPrimaryLang(v)}
              className="min-w-[90px]"
              options={[
                { value: 'jp', label: '日语' },
                { value: 'en', label: '英语' },
              ]}
            />
          </label>
          <Button
            type="button"
            onPress={() => void handleInspect()}
            isDisabled={isInspecting || !url.trim()}
          >
            {isInspecting ? '抓取中...' : '预览字幕'}
          </Button>
          <Button
            type="button"
            onPress={() => void handleImport()}
            isDisabled={isImporting || !url.trim()}
          >
            {isImporting ? '导入中...' : '导入'}
          </Button>
          <Button variant="outline" size="sm"
            type="button"
            onPress={() => setMp3ModalOpen(true)}
          >
            从 MP3 导入
          </Button>
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
              <TextArea
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
              <TextArea
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
          <div className="card mt-3 bg-surface-secondary">
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

      <div className="mt-4 flex items-center gap-2">
        {(
          [
            ['series', '按套'],
            ['time', '按时间'],
          ] as const
        ).map(([mode, label]) => (
          <Button
            key={mode}
            type="button"
            size="sm"
            variant={viewMode === mode ? 'primary' : 'outline'}
            onPress={() => setViewMode(mode)}
          >
            {label}
          </Button>
        ))}
      </div>

      <div className="flex flex-col gap-6">
        {(viewMode === 'series' ? seriesGroups : groups).map((group) => {
          // 只有成套的才显示「N 场 · 已听完 M 场」；未归类和按时间分组不显示。
          const showProgress = !group.loose
          const finished = showProgress ? group.items.filter(isFinished).length : 0
          return (
            <section key={group.key}>
              <div className="mt-2 mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h3 className="text-lg font-semibold text-foreground">{group.label}</h3>
                {showProgress ? (
                  <span className="muted text-[13px]">
                    {group.items.length} 场
                    <span className="opacity-60"> · </span>
                    已听完 {finished} 场
                  </span>
                ) : null}
              </div>
              <ul className="m-0 flex list-none flex-col gap-4 p-0">
                {group.items.map((p) => renderCard(p, viewMode === 'series'))}
              </ul>
            </section>
          )
        })}
      </div>

      <Modal
        footer={
          <>
            <Button variant="tertiary" onPress={() => setEditing(null)}>
              取消
            </Button>
            <Button isPending={isSavingMeta} onPress={() => void handleSaveMeta()}>
              {isSavingMeta ? '保存中...' : '保存'}
            </Button>
          </>
        }
        isOpen={editing !== null}
        size="md"
        title="编辑 / 归类"
        onClose={() => setEditing(null)}
      >
        <div style={{ display: 'grid', gap: 12 }}>
          <label style={{ display: 'grid', gap: 4 }}>
            <span className="muted">标题</span>
            <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
          </label>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <label style={{ display: 'grid', gap: 4 }}>
              <span className="muted">级别</span>
              <SelectField
                value={editLevel}
                onChange={(v) => setEditLevel(v)}
                options={LEVEL_OPTIONS}
                className="min-w-[110px]"
              />
            </label>
            <label style={{ display: 'grid', gap: 4 }}>
              <span className="muted">年份</span>
              <Input
                value={editYear}
                onChange={(e) => setEditYear(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="2011"
                className="max-w-[110px]"
                inputMode="numeric"
              />
            </label>
            <label style={{ display: 'grid', gap: 4 }}>
              <span className="muted">月份</span>
              <SelectField
                value={editMonth}
                onChange={(v) => setEditMonth(v)}
                options={MONTH_OPTIONS}
                className="min-w-[110px]"
              />
            </label>
          </div>
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>
            同一级别 + 同一年的几场算一套，在「按套」视图里排在一起。年份留空就是未归类。
          </p>
        </div>
      </Modal>

      <Modal
        footer={
          <>
            <Button variant="tertiary" onPress={() => setMp3ModalOpen(false)}>
              取消
            </Button>
            <Button isPending={isMp3Importing} onPress={() => void handleMp3Import()}>
              {isMp3Importing ? '导入中...' : '导入'}
            </Button>
          </>
        }
        isOpen={mp3ModalOpen}
        size="lg"
        title="从 MP3 导入播客"
        onClose={() => setMp3ModalOpen(false)}
      >
        <div style={{ display: 'grid', gap: 12 }}>
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>
            用法:先把 mp3 文件放到{' '}
            <code>client/public/podcast-media/</code> 下(例如 <code>my-cast.mp3</code>),
            然后 <b>mp3 路径</b>填 <code>/podcast-media/my-cast.mp3</code>。SRT 字幕文件粘贴到下面。
          </p>
          <label style={{ display: 'grid', gap: 4 }}>
            <span className="muted">标题 *</span>
            <Input
              value={mp3Title}
              onChange={(e) => setMp3Title(e.target.value)}
              placeholder="例如:N1 听力真题 2011-07"
            />
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            <span className="muted">mp3 路径 *</span>
            <Input
              value={mp3Url}
              onChange={(e) => setMp3Url(e.target.value)}
              placeholder="/podcast-media/xxx.mp3"
            />
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            <span className="muted">主语言</span>
            <SelectField
              value={mp3Lang}
              onChange={(v) => setMp3Lang(v)}
              options={[
                { value: 'jp', label: '日语' },
                { value: 'en', label: '英语' },
              ]}
              className="max-w-[160px]"
            />
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            <span className="muted">
              主语言字幕(.srt) *
              <input
                type="file"
                accept=".srt,.vtt,text/plain"
                onChange={(e) => handleMp3SrtFile(e, setMp3PrimarySrt)}
                style={{ marginLeft: 8 }}
              />
            </span>
            <TextArea
              rows={5}
              value={mp3PrimarySrt}
              onChange={(e) => setMp3PrimarySrt(e.target.value)}
              placeholder="粘贴 .srt 或 .vtt 内容"
              style={{ fontFamily: 'monospace', fontSize: 12 }}
            />
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            <span className="muted">
              中文字幕(可选)
              <input
                type="file"
                accept=".srt,.vtt,text/plain"
                onChange={(e) => handleMp3SrtFile(e, setMp3ZhSrt)}
                style={{ marginLeft: 8 }}
              />
            </span>
            <TextArea
              rows={4}
              value={mp3ZhSrt}
              onChange={(e) => setMp3ZhSrt(e.target.value)}
              placeholder="如有中文字幕也粘进来,会按时间对齐到主语言行"
              style={{ fontFamily: 'monospace', fontSize: 12 }}
            />
          </label>
        </div>
      </Modal>
    </section>
  )
}
