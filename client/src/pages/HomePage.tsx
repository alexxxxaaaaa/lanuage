import { Avatar, Button, Card, Chip, Separator, toast } from '@heroui/react'
import { Info, LogOut, Shuffle } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'

import { AiUsageCard } from '../components/AiUsageCard'
import { WeeklyReviewModal } from '../components/WeeklyReviewModal'
import { Modal } from '../components/ui/Modal'
import { SelectField } from '../components/ui/SelectField'
import { Stat } from '../components/ui/Stat'
import { TabsView } from '../components/ui/TabsView'
import { alertDialog } from '../components/ui/dialog'
import { getTodayLearnedStats, markWordMastered } from '../api/review'
import { getTodayNewWords } from '../api/words'
import { useI18n, type UiLanguage } from '../i18n'
import { useAppStore } from '../store/useAppStore'
import { sessionPath } from '../store/useActiveSessions'
import { useAuthStore } from '../store/authStore'
import type { Word } from '../types'

/** `null` is "no cap" — the learn session then covers every new word. */
const LEARN_LIMITS: readonly (number | null)[] = [5, 10, 15, 20, 30, 50, 100, null]

/** UI language → the BCP 47 tag `toLocaleDateString` wants for the header date. */
const DATE_LOCALES: Record<UiLanguage, string> = {
  zh: 'zh-CN',
  en: 'en-US',
  jp: 'ja-JP',
}

/** The shape both preview lists boil down to — a due item or a new word. */
type PreviewWord = {
  id: string
  word: string
  reading?: string | null
  meaning?: string | null
  language: string
}

function WordPreviewList({
  items,
  busyId,
  onMaster,
}: {
  items: PreviewWord[]
  busyId: string | null
  onMaster: (id: string, word: string) => void
}) {
  const { t } = useI18n()

  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0 text-left">
      {items.map((item) => (
        <li
          key={item.id}
          className="flex flex-col gap-1.5 rounded-xl bg-surface-secondary px-3.5 py-3"
        >
          <div className="flex flex-wrap items-center gap-2">
            <strong>{item.word}</strong>
            {item.reading ? <span className="muted">{item.reading}</span> : null}
            <Chip color="accent" size="sm" variant="soft">
              {item.language.toUpperCase()}
            </Chip>
          </div>
          {item.meaning ? (
            <p className="muted m-0 text-[13px]">{item.meaning}</p>
          ) : null}
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="outline"
              isDisabled={busyId === item.id}
              onPress={() => onMaster(item.id, item.word)}
            >
              {busyId === item.id ? t('home.marking') : t('home.markMastered')}
            </Button>
          </div>
        </li>
      ))}
    </ul>
  )
}

/**
 * localStorage key marking this Friday's weekly review as already shown, or
 * null on any other day. The date is part of the key, so "dismissed" expires
 * on its own each week.
 */
function fridayReviewKey(): string | null {
  const now = new Date()
  if (now.getDay() !== 5) return null // 5 = Friday
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `weekly-review-seen:${y}-${m}-${d}`
}

/**
 * The dashboard: who is signed in, what is due today, the folders to work
 * through, and what the AI features have cost. Everything that used to live on
 * a separate account page is folded in here — this is the only page a session
 * has to start from.
 */
export function HomePage() {
  const navigate = useNavigate()
  const { t, language } = useI18n()
  const user = useAuthStore((state) => state.user)
  const folders = useAppStore((state) => state.folders)
  const isLoadingFolders = useAppStore((state) => state.isLoadingFolders)
  const dueReviews = useAppStore((state) => state.dueReviews)
  const sessionLimit = useAppStore((state) => state.sessionLimit)
  const isLoadingReviews = useAppStore((state) => state.isLoadingReviews)
  const error = useAppStore((state) => state.error)
  const folderList = Array.isArray(folders) ? folders : []
  // Always show the full due pool here; `todayReviews` is narrowed by the
  // per-session folder filter chosen on the review page, which would hide the
  // other folders' words from a dashboard that is meant to cover everything.
  const dueListItems = useMemo(
    () => (Array.isArray(dueReviews) ? dueReviews : []),
    [dueReviews],
  )
  const dueCount = dueListItems.length
  // One pass feeds both the per-folder counts on the cards and the tabbed
  // preview list in the modal.
  const dueByFolder = useMemo(() => {
    const map = new Map<string, { name: string; items: PreviewWord[] }>()
    for (const item of dueListItems) {
      const { folder } = item.word
      const group = map.get(folder.id) ?? { name: folder.name, items: [] }
      group.items.push({ ...item.word, id: item.wordId })
      map.set(folder.id, group)
    }
    return map
  }, [dueListItems])
  const totalWords = folderList.reduce(
    (sum, folder) => sum + (folder._count?.words ?? 0),
    0,
  )

  const [todayLearned, setTodayLearned] = useState({ en: 0, jp: 0, total: 0 })
  const [showDueList, setShowDueList] = useState(false)
  // When set, opens the new-learn preview modal scoped to that folder.
  const [learnFolderId, setLearnFolderId] = useState<string | null>(null)
  const [todayNewWords, setTodayNewWords] = useState<Word[]>([])
  const [masteringWordId, setMasteringWordId] = useState<string | null>(null)

  // Auto-open the weekly review modal on Fridays, once per week. Decided while
  // initialising state rather than in an effect, so the modal is part of the
  // first paint instead of popping in one render later.
  const [weeklySeenKey] = useState(fridayReviewKey)
  const [weeklyOpen, setWeeklyOpen] = useState(
    () => weeklySeenKey !== null && !localStorage.getItem(weeklySeenKey),
  )

  useEffect(() => {
    if (weeklyOpen && weeklySeenKey) localStorage.setItem(weeklySeenKey, '1')
  }, [weeklyOpen, weeklySeenKey])

  const newWordsForLearnFolder = useMemo(() => {
    if (!learnFolderId) return [] as Word[]
    const filtered = todayNewWords.filter(
      (w) => (w.folder?.id ?? w.folderId) === learnFolderId,
    )
    // The modal previews exactly what the upcoming /learn session will cover,
    // so it must respect the same `Learn Count` cap the learn page applies.
    return sessionLimit === null ? filtered : filtered.slice(0, sessionLimit)
  }, [todayNewWords, learnFolderId, sessionLimit])

  const learnFolderName = learnFolderId
    ? (folderList.find((f) => f.id === learnFolderId)?.name ?? '')
    : ''

  useEffect(() => {
    useAppStore.getState().clearError()
    void useAppStore.getState().fetchFolders()
    void useAppStore.getState().fetchTodayReviews()
    void getTodayNewWords().then((list) => {
      setTodayNewWords(Array.isArray(list) ? list : [])
    })
    void getTodayLearnedStats().then((stats) => {
      setTodayLearned({
        en: stats?.en ?? 0,
        jp: stats?.jp ?? 0,
        total: stats?.total ?? 0,
      })
    })
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
    useAppStore.getState().dropDueWords([wordId])
    try {
      await markWordMastered(wordId)
      toast.success(t('home.markedMastered', { word: wordLabel }))
    } catch {
      toast.danger(t('home.markMasteredFailed'))
      // Server rejected — reload authoritative state so the local optimistic
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

  // Reviewing is per-wordlist: the session lives on the wordlist's own route,
  // so it can be left and resumed without disturbing any other list's session.
  const handleStartReviewByFolder = (folderId: string) => {
    navigate(sessionPath('review', folderId))
  }

  const displayName = user?.username || '—'
  const todayLabel = useMemo(
    () =>
      new Date().toLocaleDateString(DATE_LOCALES[language], {
        month: 'long',
        day: 'numeric',
        weekday: 'long',
      }),
    [language],
  )

  return (
    <section className="page">
      <Card>
        {/* Identity only — sign out is the one thing here that isn't about
            today's session, so it sits apart as a quiet icon. */}
        <Card.Header className="flex-row items-center gap-4">
          <Avatar size="lg">
            <Avatar.Fallback>{displayName.slice(0, 2).toUpperCase()}</Avatar.Fallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <Card.Title className="truncate text-lg">{displayName}</Card.Title>
            <Card.Description>{todayLabel}</Card.Description>
          </div>
          <Button
            isIconOnly
            variant="ghost"
            aria-label={t('auth.logout')}
            render={(props) => <button {...props} title={t('auth.logout')} />}
            onPress={() => {
              useAuthStore.getState().clearSession()
              navigate('/login', { replace: true })
            }}
          >
            <LogOut className="size-4" aria-hidden />
          </Button>
        </Card.Header>

        <Separator />

        {/* Same 4-column stat grid and footer-of-controls as the AI usage card
            below, so the two read as one dashboard rather than two layouts. */}
        <Card.Content className="grid grid-cols-2 gap-5 sm:grid-cols-4">
          <Stat
            accent
            label={t('home.dueLabel')}
            value={isLoadingReviews ? '—' : dueCount}
          />
          <Stat
            label={t('home.learnedTodayLabel')}
            value={todayLearned.total}
            hint={t('home.langSplit', { en: todayLearned.en, jp: todayLearned.jp })}
          />
        </Card.Content>

        <Card.Footer className="flex-wrap gap-2">
          {dueCount > 0 ? (
            <Button size="sm" variant="outline" onPress={() => setShowDueList(true)}>
              {t('home.showDueList', { count: dueCount })}
            </Button>
          ) : null}
          <Button size="sm" variant="outline" onPress={() => setWeeklyOpen(true)}>
            {t('home.weeklyReview')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onPress={() =>
              void alertDialog.info({
                title: t('home.algoTitle'),
                content: t('home.algoBrief'),
              })
            }
          >
            <Info className="size-4" aria-hidden />
            {t('home.algoInfo')}
          </Button>
        </Card.Footer>
      </Card>

      {error ? <p className="error-text">{error}</p> : null}

      <Card>
        <Card.Header className="flex-row flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <Card.Title className="text-base">{t('routes.folders')}</Card.Title>
            <Card.Description>
              {t('home.librarySummary', {
                folders: folderList.length,
                words: totalWords,
              })}
            </Card.Description>
          </div>
          {/* One control for every card: the cap is a single global setting,
              so showing it per folder only suggested otherwise. */}
          <label className="session-inline">
            <span>{t('home.learnLimit')}</span>
            <SelectField
              aria-label={t('home.learnLimit')}
              className="min-w-[104px]"
              value={sessionLimit === null ? 'all' : String(sessionLimit)}
              onChange={(value) =>
                useAppStore
                  .getState()
                  .setSessionLimit(value === 'all' ? null : Number(value))
              }
              options={LEARN_LIMITS.map((limit) => ({
                value: limit === null ? 'all' : String(limit),
                label: limit === null ? t('home.all') : `${limit}${t('home.unit')}`,
              }))}
            />
          </label>
        </Card.Header>

        <Card.Content>
          {folderList.length === 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-surface-secondary px-4 py-5">
              <span className="muted">{t('home.noFolders')}</span>
              <Button size="sm" variant="secondary" onPress={() => navigate('/folders')}>
                {t('home.manageFolders')}
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(232px,1fr))] gap-3">
              {folderList.map((folder) => {
                const due = dueByFolder.get(folder.id)?.items.length ?? 0
                return (
                  // `secondary` lifts the tile off the card it sits in — nested
                  // `default` cards would be the same surface twice over.
                  // `shadow-none`: the tile separates by surface colour, and a
                  // drop shadow inside a card only muddies the edge.
                  <Card
                    key={folder.id}
                    variant="secondary"
                    className="gap-2.5 shadow-none"
                  >
                    <Link
                      to={`/folders/${folder.id}`}
                      className="flex min-w-0 flex-col gap-1.5 text-inherit no-underline"
                    >
                      <div className="flex items-center gap-2">
                        <Card.Title className="min-w-0 flex-1 truncate text-base font-semibold">
                          {folder.name}
                        </Card.Title>
                        <Chip size="sm" variant="secondary">
                          {folder.language.toUpperCase()}
                        </Chip>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Card.Description>
                          {t('home.wordCount', { count: folder._count?.words ?? 0 })}
                        </Card.Description>
                        {due > 0 ? (
                          <Chip color="accent" size="sm" variant="soft">
                            {t('home.dueChip', { count: due })}
                          </Chip>
                        ) : null}
                      </div>
                    </Link>
                    <Card.Footer className="mt-auto gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        isDisabled={isLoadingFolders || isLoadingReviews}
                        onPress={() => setLearnFolderId(folder.id)}
                      >
                        {t('home.learnNew')}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        isDisabled={isLoadingFolders || isLoadingReviews || due === 0}
                        onPress={() => handleStartReviewByFolder(folder.id)}
                      >
                        {t('home.review')}
                      </Button>
                    </Card.Footer>
                  </Card>
                )
              })}
            </div>
          )}
        </Card.Content>
      </Card>

      <AiUsageCard />

      <Modal
        title={t('home.dueListTitle', { count: dueCount })}
        isOpen={showDueList}
        onClose={() => setShowDueList(false)}
        size="md"
      >
        {dueCount === 0 ? (
          <p className="muted">{t('home.dueListEmpty')}</p>
        ) : (
          <>
            <div className="mb-2 flex justify-end">
              <Button
                size="sm"
                variant="ghost"
                render={(props) => <button {...props} title={t('home.shuffleTip')} />}
                onPress={() => useAppStore.getState().shuffleDueReviews()}
              >
                <Shuffle className="size-4" aria-hidden />
                {t('home.shuffle')}
              </Button>
            </div>
            <TabsView
              items={Array.from(dueByFolder, ([folderId, group]) => ({
                key: folderId,
                label: `${group.name}（${group.items.length}）`,
                children: (
                  <WordPreviewList
                    items={group.items}
                    busyId={masteringWordId}
                    onMaster={(id, word) => void handleMarkMastered(id, word)}
                  />
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
          <div className="flex justify-end gap-2">
            <Button variant="tertiary" onPress={() => setLearnFolderId(null)}>
              {t('common.close')}
            </Button>
            <Button
              isDisabled={newWordsForLearnFolder.length === 0}
              onPress={() => {
                if (!learnFolderId) return
                const target = sessionPath('learn', learnFolderId)
                setLearnFolderId(null)
                navigate(target)
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
          <WordPreviewList
            items={newWordsForLearnFolder}
            busyId={masteringWordId}
            onMaster={(id, word) => void handleMarkMastered(id, word)}
          />
        )}
      </Modal>

      <WeeklyReviewModal open={weeklyOpen} onClose={() => setWeeklyOpen(false)} />
    </section>
  )
}
