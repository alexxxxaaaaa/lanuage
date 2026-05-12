import { useEffect, useMemo, useState } from 'react'
import { Modal } from 'antd'
import { Link, useNavigate } from 'react-router-dom'
import { useI18n } from '../i18n'
import { getTodayLearnedStats, getTomorrowReviewStats } from '../api/review'
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
  useEffect(() => {
    useAppStore.getState().clearError()
    void useAppStore.getState().fetchFolders()
    void useAppStore.getState().fetchTodayReviews()
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

  const handleStartLearnByFolder = (folderId: string) => {
    useAppStore.getState().setReviewFolderId(folderId)
    navigate('/learn')
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
