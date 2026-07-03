import { useEffect, useMemo, useState } from 'react'
import { Modal, Tabs, message } from 'antd'
import { Link, useNavigate } from 'react-router-dom'
import { useI18n } from '../i18n'
import {
  getTodayLearnedStats,
  getTomorrowReviewStats,
  markWordMastered,
} from '../api/review'
import { getTodayNewWords } from '../api/words'
import type { Word } from '../types'
import { useAppStore } from '../store/useAppStore'

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
      message.success(t('home.markedMastered', { word: wordLabel }))
    } catch {
      message.error(t('home.markMasteredFailed'))
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
      <div className="card hero-card">
        <p className="eyebrow">Today Review</p>
        <div className="home-hero-title-row">
          <h2>{t('home.title')}</h2>
          <button
            type="button"
            className="secondary-button"
            onClick={() =>
              Modal.info({
                title: t('home.algoTitle'),
                width: 640,
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
          </button>
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
          <div className="home-due-list-block">
            <button
              type="button"
              className="ghost-button home-due-toggle"
              onClick={() => setShowDueList(true)}
            >
              {t('home.showDueList', { count: dueListItems.length })}
            </button>
          </div>
        ) : null}

        <Modal
          title={t('home.dueListTitle', { count: dueListItems.length })}
          open={showDueList}
          onCancel={() => setShowDueList(false)}
          footer={null}
          width={560}
          styles={{ body: { maxHeight: '70vh', overflowY: 'auto' } }}
        >
          {dueListItems.length === 0 ? (
            <p className="muted">{t('home.dueListEmpty')}</p>
          ) : (
            <>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
              <button
                type="button"
                className="ghost-button"
                title="打乱今日复习顺序(下次刷新会重置)"
                onClick={() => useAppStore.getState().shuffleTodayReviews()}
              >
                🔀 打乱顺序
              </button>
            </div>
            <Tabs
              items={dueGroups.map((group) => ({
                key: group.folderId,
                label: `${group.folderName}（${group.items.length}）`,
                children: (
                  <ul className="home-due-list">
                    {group.items.map((item) => (
                      <li key={item.wordId} className="home-due-item">
                        <div className="home-due-item-info">
                          <strong>{item.word.word}</strong>
                          {item.word.reading ? (
                            <span className="muted">{item.word.reading}</span>
                          ) : null}
                          <span className="folder-language">
                            {item.word.language.toUpperCase()}
                          </span>
                        </div>
                        {item.word.meaning ? (
                          <p className="muted home-due-item-meaning">
                            {item.word.meaning}
                          </p>
                        ) : null}
                        <div className="home-due-item-actions">
                          <button
                            type="button"
                            className="ghost-button"
                            disabled={masteringWordId === item.wordId}
                            onClick={() =>
                              void handleMarkMastered(item.wordId, item.word.word)
                            }
                          >
                            {masteringWordId === item.wordId
                              ? t('home.marking')
                              : t('home.markMastered')}
                          </button>
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
          open={learnFolderId !== null}
          onCancel={() => setLearnFolderId(null)}
          footer={
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="ghost-button" onClick={() => setLearnFolderId(null)}>
                {t('expression.collapseCreate')}
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={newWordsForLearnFolder.length === 0}
                onClick={() => {
                  if (!learnFolderId) return
                  useAppStore.getState().setReviewFolderId(learnFolderId)
                  setLearnFolderId(null)
                  navigate('/learn')
                }}
              >
                {t('home.learnNew')}
              </button>
            </div>
          }
          width={560}
          styles={{ body: { maxHeight: '70vh', overflowY: 'auto' } }}
        >
          {newWordsForLearnFolder.length === 0 ? (
            <p className="muted">{t('home.newListEmpty')}</p>
          ) : (
            <ul className="home-due-list">
              {newWordsForLearnFolder.map((w) => (
                <li key={w.id} className="home-due-item">
                  <div className="home-due-item-info">
                    <strong>{w.word}</strong>
                    {w.reading ? <span className="muted">{w.reading}</span> : null}
                    <span className="folder-language">{w.language.toUpperCase()}</span>
                  </div>
                  {w.meaning ? (
                    <p className="muted home-due-item-meaning">{w.meaning}</p>
                  ) : null}
                  <div className="home-due-item-actions">
                    <button
                      type="button"
                      className="ghost-button"
                      disabled={masteringWordId === w.id}
                      onClick={() => void handleMarkMastered(w.id, w.word)}
                    >
                      {masteringWordId === w.id
                        ? t('home.marking')
                        : t('home.markMastered')}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Modal>
        {/* <div className="hero-actions">
          <button
            type="button"
            className="primary-button"
            onClick={handleStartLearnAll}
            disabled={isLoadingReviews}
          >
            全部分类开始学习
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={handleStartReviewAll}
            disabled={isLoadingReviews || dueCount === 0}
          >
            全部分类开始复习
          </button>
          <Link className="secondary-link" to="/folders">
            查看分类
          </Link>
          <button
            type="button"
            className="secondary-button"
            disabled={isLoadingReviews || isLoadingFolders}
            onClick={() => {
              void useAppStore.getState().fetchFolders()
              void useAppStore.getState().fetchTodayReviews()
            }}
          >
            刷新数据
          </button>
        </div> */}

        {error ? <p className="error-text">{error}</p> : null}
      </div>

      <div className="home-modules">
        <Link className="home-module-card" to="/folders">
          <div className="home-module-icon">📚</div>
          <div className="home-module-body">
            <strong>{t('nav.folders')}</strong>
            <span className="muted">按语言/教材分类管理单词</span>
          </div>
          <span className="home-module-arrow">→</span>
        </Link>
        <Link className="home-module-card" to="/notes">
          <div className="home-module-icon">📝</div>
          <div className="home-module-body">
            <strong>{t('nav.notes')}</strong>
            <span className="muted">摘录文章 / 课文，挑词加入词库</span>
          </div>
          <span className="home-module-arrow">→</span>
        </Link>
        <Link className="home-module-card" to="/expressions">
          <div className="home-module-icon">💬</div>
          <div className="home-module-body">
            <strong>{t('nav.expressions')}</strong>
            <span className="muted">收集口语化短句和场景表达</span>
          </div>
          <span className="home-module-arrow">→</span>
        </Link>
      </div>

      <div className="folder-grid home-action-grid">
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
            <div className="folder-card-actions home-folder-actions">
              <label className="session-inline home-folder-limit">
                <span className="muted">{t('home.learnLimit')}</span>
                <select
                  value={sessionLimit === null ? 'all' : String(sessionLimit)}
                  onChange={(event) => handleLearnLimitChange(event.target.value)}
                >
                  {LEARN_LIMIT_OPTIONS.map((option) => (
                    <option
                      key={option.value === null ? 'all' : option.value}
                      value={option.value === null ? 'all' : String(option.value)}
                    >
                      {option.value === null
                        ? t('home.all')
                        : `${option.value}${t('home.unit')}`}
                    </option>
                  ))}
                </select>
              </label>
              <div>
                <button
                type="button"
                className="ghost-button"
                disabled={isLoadingFolders || isLoadingReviews}
                onClick={() => handleStartLearnByFolder(folder.id)}
              >
                {t('home.learnNew')}
              </button>
              <button
                type="button"
                className="ghost-button"
                disabled={isLoadingFolders || isLoadingReviews}
                onClick={() => handleStartReviewByFolder(folder.id)}
              >
                {t('home.review')}
              </button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
