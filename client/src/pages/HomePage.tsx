import { useEffect, useMemo, useState } from 'react'
import { Button, toast } from '@heroui/react'
import { Modal } from '../components/ui/Modal'
import { SelectField } from '../components/ui/SelectField'
import { TabsView } from '../components/ui/TabsView'
import { alertDialog } from '../components/ui/dialog'
import { Link, useNavigate } from 'react-router'
import { useI18n } from '../i18n'
import {
  getTodayLearnedStats,
  getTomorrowReviewStats,
  markWordMastered,
} from '../api/review'
import { getTodayNewWords } from '../api/words'
import type { Word } from '../types'
import { useAppStore } from '../store/useAppStore'
import { WeeklyReviewModal } from '../components/WeeklyReviewModal'

const LEARN_LIMIT_OPTIONS: { value: number | null; label: string }[] = [
  { value: 5, label: '5 个' },
  { value: 10, label: '10 个' },
  { value: 15, label: '15 个' },
  { value: 20, label: '20 个' },
  { value: 30, label: '30 个' },
  { value: 50, label: '50 个' },
  { value: 100, label: '100 个' },
  { value: null, label: '全部' },
]

export function HomePage() {
  const navigate = useNavigate()
  const { t } = useI18n()
  const folders = useAppStore((state) => state.folders)
  const isLoadingFolders = useAppStore((state) => state.isLoadingFolders)
  const dueReviews = useAppStore((state) => state.dueReviews)
  const sessionLimit = useAppStore((state) => state.sessionLimit)
  const isLoadingReviews = useAppStore((state) => state.isLoadingReviews)
  const error = useAppStore((state) => state.error)
  const folderList = Array.isArray(folders) ? folders : []
  const dueCount = Array.isArray(dueReviews) ? dueReviews.length : 0
  const dueCountByFolder = useMemo(() => {
    const map = new Map<string, number>()
    if (!Array.isArray(dueReviews)) return map
    for (const item of dueReviews) {
      const id = item.word.folder.id
      map.set(id, (map.get(id) ?? 0) + 1)
    }
    return map
  }, [dueReviews])
  const [todayLearned, setTodayLearned] = useState({ en: 0, jp: 0, total: 0 })
  const [tomorrowReview, setTomorrowReview] = useState({ en: 0, jp: 0, total: 0 })
  const [showDueList, setShowDueList] = useState(false)
  // When set, opens the new-learn preview modal scoped to that folder.
  const [learnFolderId, setLearnFolderId] = useState<string | null>(null)
  const [todayNewWords, setTodayNewWords] = useState<Word[]>([])
  const [masteringWordId, setMasteringWordId] = useState<string | null>(null)
  const [weeklyOpen, setWeeklyOpen] = useState(false)

  // Auto-open the weekly review modal on Fridays, once per week. localStorage
  // key includes ISO week so the "dismissed" state resets each Friday.
  useEffect(() => {
    const now = new Date()
    if (now.getDay() !== 5) return // 5 = Friday
    const y = now.getFullYear()
    const m = String(now.getMonth() + 1).padStart(2, '0')
    const d = String(now.getDate()).padStart(2, '0')
    const key = `weekly-review-seen:${y}-${m}-${d}`
    if (localStorage.getItem(key)) return
    setWeeklyOpen(true)
    localStorage.setItem(key, '1')
  }, [])
  // Always show full due pool on Home; todayReviews is filtered by reviewFolderId
  // (the per-session filter chosen in the Review page) which would hide other folders.
  const dueListItems = useMemo(
    () => (Array.isArray(dueReviews) ? dueReviews : []),
    [dueReviews],
  )

  // Group due items by folder for tabbed display.
  const dueGroups = useMemo(() => {
    const map = new Map<string, { folderId: string; folderName: string; items: typeof dueListItems }>()
    for (const item of dueListItems) {
      const folderId = item.word.folder?.id ?? item.word.folderId ?? 'unknown'
      const folderName = item.word.folder?.name ?? item.word.language.toUpperCase()
      const group = map.get(folderId) ?? { folderId, folderName, items: [] }
      group.items.push(item)
      map.set(folderId, group)
    }
    return Array.from(map.values())
  }, [dueListItems])

  const newWordsForLearnFolder = useMemo(() => {
    if (!learnFolderId) return [] as Word[]
    const filtered = todayNewWords.filter(
      (w) => (w.folder?.id ?? w.folderId) === learnFolderId,
    )
    // Modal previews exactly what the upcoming /learn session will cover, so
    // it must respect the same `Learn Count` cap the learn page applies.
    return sessionLimit === null ? filtered : filtered.slice(0, sessionLimit)
  }, [todayNewWords, learnFolderId, sessionLimit])

  const learnFolderName = useMemo(() => {
    if (!learnFolderId) return ''
    return folderList.find((f) => f.id === learnFolderId)?.name ?? ''
  }, [folderList, learnFolderId])
  useEffect(() => {
    useAppStore.getState().clearError()
    void useAppStore.getState().fetchFolders()
    void useAppStore.getState().fetchTodayReviews()
    void getTodayNewWords().then((list) => {
      setTodayNewWords(Array.isArray(list) ? list : [])
    })
    void Promise.all([getTodayLearnedStats(), getTomorrowReviewStats()]).then(
      ([todayStats, tomorrowStats]) => {
        setTodayLearned({
          en: todayStats?.en ?? 0,
          jp: todayStats?.jp ?? 0,
          total: todayStats?.total ?? 0,
        })
        setTomorrowReview({
          en: tomorrowStats?.en ?? 0,
          jp: tomorrowStats?.jp ?? 0,
          total: tomorrowStats?.total ?? 0,
        })
      },
    )
  }, [])

  const handleMarkMastered = async (wordId: string, wordLabel: string) => {
    if (masteringWordId) return
    setMasteringWordId(wordId)
    // Optimistic local removal: mark-mastered ONLY affects membership in the
    // today-new / today-review pools (the server pushes nextReviewDate 10 yrs
    // out). Everything else stays put — no folder counts move, no other
    // words change. So we splice locally and skip the 3× refetches the old
    // flow did on every click. Rapid marks used to fire 3 parallel Worker
    // requests each — 5 clicks = 15 concurrent D1 hits = 503s. Now: 1 mark
    // request, no refetch. If the mark itself fails, we reconcile.
    setTodayNewWords((prev) => prev.filter((w) => w.id !== wordId))
    useAppStore.setState((state) => ({
      todayReviews: state.todayReviews.filter((r) => r.wordId !== wordId),
      dueReviews: state.dueReviews.filter((r) => r.wordId !== wordId),
    }))
    try {
      await markWordMastered(wordId)
      toast.success(t('home.markedMastered', { word: wordLabel }))
    } catch {
      toast.danger(t('home.markMasteredFailed'))
      // Server rejected — reload authoritative state so local optimistic
      // removal doesn't outlive reality.
      const [, list] = await Promise.all([
        useAppStore.getState().fetchTodayReviews(),
        getTodayNewWords(),
      ])
      setTodayNewWords(Array.isArray(list) ? list : [])
    } finally {
      setMasteringWordId(null)
    }
  }

  const handleStartLearnByFolder = (folderId: string) => {
    setLearnFolderId(folderId)
  }

  const handleStartReviewByFolder = (folderId: string) => {
    useAppStore.getState().setReviewFolderId(folderId)
    void useAppStore.getState().fetchTodayReviews()
    navigate('/review')
  }

  const handleLearnLimitChange = (value: string) => {
    const next = value === 'all' ? null : Number(value)
    useAppStore.getState().setSessionLimit(next)
  }

  return (
    <section className="page">
      <div className="card py-12 text-center">
        <p className="eyebrow">Today Review</p>
        <div className="flex flex-wrap items-center justify-center gap-2.5">
          <h2>{t('home.title')}</h2>
          <Button variant="outline"
            type="button"
            onPress={() => setWeeklyOpen(true)}
          >
            本周回顾
          </Button>
          <Button variant="outline"
            type="button"
            onPress={() =>
              void alertDialog.info({
                title: t('home.algoTitle'),
                okText: t('expression.save'),
                content: (
                  <div>
                    <p>{t('home.algoBrief')}</p>
                  </div>
                ),
              })
            }
          >
            {t('home.algoInfo')}
          </Button>
        </div>
        <p className="hero-count">{isLoadingReviews ? '...' : dueCount}</p>
        {todayLearned.total > 0 ? (
          <p className="muted">
            {t('home.todayLearned', {
              en: todayLearned.en,
              jp: todayLearned.jp,
              total: todayLearned.total,
            })}
          </p>
        ) : null}
        {tomorrowReview.total > 0 ? (
          <p className="muted">
            {t('home.tomorrowReview', {
              en: tomorrowReview.en,
              jp: tomorrowReview.jp,
              total: tomorrowReview.total,
            })}
          </p>
        ) : null}

        {dueListItems.length > 0 ? (
          <div className="mt-4 flex flex-col items-center gap-3">
            <Button variant="outline" size="sm" className="self-center"
              type="button"
              onPress={() => setShowDueList(true)}
            >
              {t('home.showDueList', { count: dueListItems.length })}
            </Button>
          </div>
        ) : null}

        <Modal
          title={t('home.dueListTitle', { count: dueListItems.length })}
          isOpen={showDueList}
          onClose={() => setShowDueList(false)}
          size="md"
        >
          {dueListItems.length === 0 ? (
            <p className="muted">{t('home.dueListEmpty')}</p>
          ) : (
            <>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
              <Button variant="outline" size="sm"
                type="button"
                render={(props) => <button {...props} title="打乱今日复习顺序(下次刷新会重置)" />}
                onPress={() => useAppStore.getState().shuffleTodayReviews()}
              >
                🔀 打乱顺序
              </Button>
            </div>
            <TabsView
              items={dueGroups.map((group) => ({
                key: group.folderId,
                label: `${group.folderName}（${group.items.length}）`,
                children: (
                  <ul className="m-0 flex w-full max-w-[560px] list-none flex-col gap-2 p-0 text-left">
                    {group.items.map((item) => (
                      <li key={item.wordId} className="flex flex-col gap-1.5 rounded-xl border border-border bg-foreground/2 px-3.5 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <strong>{item.word.word}</strong>
                          {item.word.reading ? (
                            <span className="muted">{item.word.reading}</span>
                          ) : null}
                          <span className="folder-language">
                            {item.word.language.toUpperCase()}
                          </span>
                        </div>
                        {item.word.meaning ? (
                          <p className="muted m-0 text-[13px]">
                            {item.word.meaning}
                          </p>
                        ) : null}
                        <div className="flex justify-end gap-2">
                          <Button variant="outline" size="sm"
                            type="button"
                            isDisabled={masteringWordId === item.wordId}
                            onPress={() =>
                              void handleMarkMastered(item.wordId, item.word.word)
                            }
                          >
                            {masteringWordId === item.wordId
                              ? t('home.marking')
                              : t('home.markMastered')}
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                ),
              }))}
            />
            </>
          )}
        </Modal>

        <Modal
          title={
            learnFolderName
              ? `${t('home.newListTitle', { count: newWordsForLearnFolder.length })} · ${learnFolderName}`
              : t('home.newListTitle', { count: newWordsForLearnFolder.length })
          }
          isOpen={learnFolderId !== null}
          onClose={() => setLearnFolderId(null)}
          footer={
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <Button variant="outline" size="sm" type="button" onPress={() => setLearnFolderId(null)}>
                {t('expression.collapseCreate')}
              </Button>
              <Button
                type="button"
                isDisabled={newWordsForLearnFolder.length === 0}
                onPress={() => {
                  if (!learnFolderId) return
                  useAppStore.getState().setReviewFolderId(learnFolderId)
                  setLearnFolderId(null)
                  navigate('/learn')
                }}
              >
                {t('home.learnNew')}
              </Button>
            </div>
          }
          size="md"
        >
          {newWordsForLearnFolder.length === 0 ? (
            <p className="muted">{t('home.newListEmpty')}</p>
          ) : (
            <ul className="m-0 flex w-full max-w-[560px] list-none flex-col gap-2 p-0 text-left">
              {newWordsForLearnFolder.map((w) => (
                <li key={w.id} className="flex flex-col gap-1.5 rounded-xl border border-border bg-foreground/2 px-3.5 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong>{w.word}</strong>
                    {w.reading ? <span className="muted">{w.reading}</span> : null}
                    <span className="folder-language">{w.language.toUpperCase()}</span>
                  </div>
                  {w.meaning ? (
                    <p className="muted m-0 text-[13px]">{w.meaning}</p>
                  ) : null}
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm"
                      type="button"
                      isDisabled={masteringWordId === w.id}
                      onPress={() => void handleMarkMastered(w.id, w.word)}
                    >
                      {masteringWordId === w.id
                        ? t('home.marking')
                        : t('home.markMastered')}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Modal>
        {/* <div className="hero-actions">
          <Button
            type="button"
            onPress={handleStartLearnAll}
            isDisabled={isLoadingReviews}
          >
            全部分类开始学习
          </Button>
          <Button variant="outline"
            type="button"
            onPress={handleStartReviewAll}
            isDisabled={isLoadingReviews || dueCount === 0}
          >
            全部分类开始复习
          </Button>
          <Link className="button button--outline" to="/folders">
            查看分类
          </Link>
          <Button variant="outline"
            type="button"
            isDisabled={isLoadingReviews || isLoadingFolders}
            onPress={() => {
              void useAppStore.getState().fetchFolders()
              void useAppStore.getState().fetchTodayReviews()
            }}
          >
            刷新数据
          </Button>
        </div> */}

        {error ? <p className="error-text">{error}</p> : null}
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3">
        <Link className="flex items-center gap-3 rounded-[14px] border border-border bg-surface px-4.5 py-4 text-foreground no-underline transition-[transform,box-shadow,border-color] duration-150 hover:-translate-y-px hover:border-accent hover:shadow-[0_6px_20px_rgba(37,99,235,0.1)]" to="/folders">
          <div className="inline-flex size-11 items-center justify-center rounded-[10px] bg-accent/8 text-[26px]">📚</div>
          <div className="flex flex-1 flex-col gap-0.5">
            <strong className="text-[15px]">{t('routes.folders')}</strong>
            <span className="muted text-xs leading-[1.4]">按语言/教材分类管理单词</span>
          </div>
          <span className="text-lg font-semibold text-accent">→</span>
        </Link>
        <Link className="flex items-center gap-3 rounded-[14px] border border-border bg-surface px-4.5 py-4 text-foreground no-underline transition-[transform,box-shadow,border-color] duration-150 hover:-translate-y-px hover:border-accent hover:shadow-[0_6px_20px_rgba(37,99,235,0.1)]" to="/notes">
          <div className="inline-flex size-11 items-center justify-center rounded-[10px] bg-accent/8 text-[26px]">📝</div>
          <div className="flex flex-1 flex-col gap-0.5">
            <strong className="text-[15px]">{t('routes.notes')}</strong>
            <span className="muted text-xs leading-[1.4]">摘录文章 / 课文，挑词加入词库</span>
          </div>
          <span className="text-lg font-semibold text-accent">→</span>
        </Link>
        <Link className="flex items-center gap-3 rounded-[14px] border border-border bg-surface px-4.5 py-4 text-foreground no-underline transition-[transform,box-shadow,border-color] duration-150 hover:-translate-y-px hover:border-accent hover:shadow-[0_6px_20px_rgba(37,99,235,0.1)]" to="/expressions">
          <div className="inline-flex size-11 items-center justify-center rounded-[10px] bg-accent/8 text-[26px]">💬</div>
          <div className="flex flex-1 flex-col gap-0.5">
            <strong className="text-[15px]">{t('routes.expressions')}</strong>
            <span className="muted text-xs leading-[1.4]">收集口语化短句和场景表达</span>
          </div>
          <span className="text-lg font-semibold text-accent">→</span>
        </Link>
      </div>

      <div className="folder-grid mt-1">
        {folderList.map((folder) => (
          <article key={folder.id} className="card folder-card">
            <Link className="folder-card-link" to={`/folders/${folder.id}`}>
              <div className="folder-top">
                <strong>{folder.name}</strong>
                <span className="folder-language">{folder.language.toUpperCase()}</span>
              </div>
              <p className="muted">
                {t('home.wordsAndDue', {
                  words: folder._count?.words ?? 0,
                  due: dueCountByFolder.get(folder.id) ?? 0,
                })}
              </p>
            </Link>
            <div className="folder-card-actions flex-wrap items-center justify-between">
              <label className="session-inline justify-between">
                <span className="muted">{t('home.learnLimit')}</span>
                <SelectField
                  className="min-w-[100px]"
                  value={sessionLimit === null ? 'all' : String(sessionLimit)}
                  onChange={(v) => handleLearnLimitChange(v)}
                  options={LEARN_LIMIT_OPTIONS.map((option) => ({
                    value: option.value === null ? 'all' : String(option.value),
                    label:
                      option.value === null
                        ? t('home.all')
                        : `${option.value}${t('home.unit')}`,
                  }))}
                />
              </label>
              <div>
                <Button variant="outline" size="sm"
                  type="button"
                  isDisabled={isLoadingFolders || isLoadingReviews}
                  onPress={() => handleStartLearnByFolder(folder.id)}
                >
                {t('home.learnNew')}
              </Button>
              <Button variant="outline" size="sm"
                type="button"
                isDisabled={isLoadingFolders || isLoadingReviews}
                onPress={() => handleStartReviewByFolder(folder.id)}
              >
                {t('home.review')}
              </Button>
              </div>
            </div>
          </article>
        ))}
      </div>

      <WeeklyReviewModal open={weeklyOpen} onClose={() => setWeeklyOpen(false)} />
    </section>
  )
}
