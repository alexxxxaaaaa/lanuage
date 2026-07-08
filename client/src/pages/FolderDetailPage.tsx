import { useEffect, useMemo, useState } from 'react'
import { Input, Modal, Pagination, Select, Tag } from 'antd'
import { Link, useLocation, useParams } from 'react-router-dom'
import { fillWordByAi } from '../api/ai'
import { isDuplicateWordError } from '../api/error'
import { useI18n } from '../i18n'
import { getNotes } from '../api/notes'
import { SpeakButton } from '../components/SpeakButton'
import { useTab } from '../components/TabContext'
import { VoicePicker } from '../components/VoicePicker'
import { getFolderById } from '../api/folders'
import { updateWord as updateWordApi } from '../api/words'
import { useAppStore } from '../store/useAppStore'
import type { FolderDetail } from '../types'
import type { Word } from '../types'
import {
  getMasteryColor,
  getMasteryLabel,
  getMasteryPercent,
  getMasteryStatus,
  isTrickyWord,
} from '../utils/wordStatus'

type WordFormState = {
  word: string
  reading: string
  meaning: string
  example: string
  note: string
  partOfSpeech: string
  sourceNoteId: string
  folderId: string
}

function toFormState(word: Word): WordFormState {
  return {
    word: word.word,
    reading: word.reading,
    meaning: word.meaning,
    example: word.example,
    note: word.note,
    partOfSpeech: word.partOfSpeech ?? '',
    sourceNoteId: word.sourceNote?.id ?? '',
    folderId: word.folderId,
  }
}

function formatDueLabel(dateText: string | undefined, t: (key: string, vars?: Record<string, string | number>) => string) {
  if (!dateText) return t('folderDetail.dueUnknown')
  const dueDate = new Date(dateText)
  if (Number.isNaN(dueDate.getTime())) return t('folderDetail.dueUnknown')
  const now = new Date()
  const todayStart = new Date(now)
  todayStart.setHours(0, 0, 0, 0)
  const dueStart = new Date(dueDate)
  dueStart.setHours(0, 0, 0, 0)
  const diffDays = Math.round((dueStart.getTime() - todayStart.getTime()) / 86400000)
  if (diffDays <= 0) return t('folderDetail.dueToday')
  if (diffDays === 1) return t('folderDetail.dueTomorrow')
  return t('folderDetail.dueInDays', { days: diffDays })
}

function formatRecentRatings(value: string | undefined, t: (key: string, vars?: Record<string, string | number>) => string) {
  if (!value) return t('folderDetail.none')
  const map: Record<string, string> = { again: 'Again', hard: 'Hard', easy: 'Easy' }
  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(-3)
    .map((item) => map[item] ?? item)
  return items.length > 0 ? items.join(' / ') : t('folderDetail.none')
}

function hasLearnedProgress(word: Word) {
  return Boolean(word.review?.lastReviewedAt) || (word.review?.repetition ?? 0) > 0
}

export function FolderDetailPage() {
  const { t } = useI18n()
  const { setTitle } = useTab()
  const PAGE_SIZE = 12
  const { id } = useParams<{ id: string }>()
  const location = useLocation()
  const [highlightedWordId, setHighlightedWordId] = useState<string | null>(null)
  const folders = useAppStore((state) => state.folders)
  const isLoadingFolders = useAppStore((state) => state.isLoadingFolders)
  const isSubmitting = useAppStore((state) => state.isSubmitting)
  const error = useAppStore((state) => state.error)

  // Per-tab folder snapshot. Used to live in useAppStore.currentFolder but
  // that singleton is shared across tabs — opening a second folder in another
  // tab would clobber this one and make the page display "0 words". Local
  // state means each FolderDetailPage instance keeps its own copy.
  const [folder, setFolder] = useState<FolderDetail | null>(null)
  const [isLoadingFolder, setIsLoadingFolder] = useState(false)
  // Tracks the word id currently being pinned, so we can disable the button
  // and reject duplicate clicks. Pre-fix, spamming 置顶 fired N parallel
  // updateWord calls — each one (via the store) refetched the whole folder,
  // and that blew past D1's row-read / Worker CPU budget => 503/500.
  const [pinningId, setPinningId] = useState<string | null>(null)

  const [editingWordId, setEditingWordId] = useState<string | null>(null)
  const [form, setForm] = useState<WordFormState | null>(null)
  const [filter, setFilter] = useState<'all' | 'learned' | 'unlearned'>('all')
  const [searchKeyword, setSearchKeyword] = useState('')
  const [page, setPage] = useState(1)
  const [noteOptions, setNoteOptions] = useState<Array<{ id: string; title: string }>>([])
  // Batch-add: paste many words, AI fills each, all go into this folder.
  const [isBatchOpen, setIsBatchOpen] = useState(false)
  const [batchInput, setBatchInput] = useState('')
  const [batchRunning, setBatchRunning] = useState(false)
  const [batchResults, setBatchResults] = useState<
    Array<{
      word: string
      status: 'pending' | 'running' | 'success' | 'duplicate' | 'failed'
      message?: string
      // For duplicates: id of the already-present word, so the result row
      // can offer a "置顶" button to bump that existing entry instead.
      existingWordId?: string
    }>
  >([])
  // Retry panel — auto-opens after a batch that had failures. Lets the user
  // one-click retry only the words that didn't make it in, instead of
  // re-pasting them.
  const [isRetryOpen, setIsRetryOpen] = useState(false)
  const [retryRunning, setRetryRunning] = useState(false)
  const [retryItems, setRetryItems] = useState<
    Array<{
      word: string
      message: string
      status: 'idle' | 'running' | 'success' | 'failed'
    }>
  >([])

  const reloadFolder = async () => {
    if (!id) return
    setIsLoadingFolder(true)
    try {
      const data = await getFolderById(id)
      setFolder(data)
    } finally {
      setIsLoadingFolder(false)
    }
  }

  useEffect(() => {
    if (!id) return
    useAppStore.getState().clearError()
    void useAppStore.getState().fetchFolders()
    void reloadFolder()
    void getNotes().then((rows) =>
      setNoteOptions((rows ?? []).map((item) => ({ id: item.id, title: item.title })),
      ),
    )
    // reloadFolder is closure-stable for this id; safe to omit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  if (!id) {
    return null
  }

  const folderList = Array.isArray(folders) ? folders : []

  useEffect(() => {
    if (folder?.name) setTitle(folder.name)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder?.name])
  const words = folder?.words ?? []
  // Count words added today (user-local midnight onwards).
  const todayNewCount = useMemo(() => {
    const startOfToday = new Date()
    startOfToday.setHours(0, 0, 0, 0)
    const cutoff = startOfToday.getTime()
    return words.filter((w) => {
      if (!w.createdAt) return false
      const t = new Date(w.createdAt).getTime()
      return Number.isFinite(t) && t >= cutoff
    }).length
  }, [words])
  const learnedWords = words.filter(
    (word) =>
      Boolean(word.review?.lastReviewedAt) || (word.review?.repetition ?? 0) > 0,
  )
  const unlearnedWords = words.filter(
    (word) =>
      !word.review?.lastReviewedAt && (word.review?.repetition ?? 0) <= 0,
  )
  const filteredByLearnState =
    filter === 'learned'
      ? learnedWords
      : filter === 'unlearned'
        ? unlearnedWords
        : words
  const normalizedKeyword = searchKeyword.trim()
  const filteredWords = !normalizedKeyword
    ? filteredByLearnState
    : filteredByLearnState.filter((word) =>
        [
          word.word,
          word.reading,
          word.meaning,
          word.example,
          word.note,
          word.partOfSpeech,
        ]
          .join('\n')
          .toLowerCase()
          .includes(normalizedKeyword.toLowerCase()),
      )
  const totalPages = Math.max(1, Math.ceil(filteredWords.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pagedWords = filteredWords.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  )
  const learnedPercent =
    words.length === 0 ? 0 : Math.round((learnedWords.length / words.length) * 100)

  useEffect(() => {
    setPage(1)
  }, [filter, id])

  useEffect(() => {
    const match = location.hash.match(/^#word-(.+)$/)
    if (!match) return
    const targetId = match[1]
    const target = words.find((word) => word.id === targetId)
    if (!target) return
    if (filter !== 'all') setFilter('all')
    if (searchKeyword) setSearchKeyword('')
    const indexInFiltered = words.findIndex((word) => word.id === targetId)
    if (indexInFiltered >= 0) {
      setPage(Math.floor(indexInFiltered / PAGE_SIZE) + 1)
    }
    setHighlightedWordId(targetId)
    const timer = window.setTimeout(() => {
      const el = document.getElementById(`word-${targetId}`)
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 80)
    const fadeTimer = window.setTimeout(() => setHighlightedWordId(null), 2200)
    return () => {
      window.clearTimeout(timer)
      window.clearTimeout(fadeTimer)
    }
  }, [location.hash, words.length])

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages)
    }
  }, [page, totalPages])

  const beginEdit = (word: Word) => {
    setEditingWordId(word.id)
    setForm(toFormState(word))
  }

  const cancelEdit = () => {
    setEditingWordId(null)
    setForm(null)
  }

  const handleSave = async (event: React.FormEvent, wordId: string) => {
    event.preventDefault()
    if (!form) return
    const nextWord = form.word.trim()

    try {
      await useAppStore.getState().updateWord(wordId, {
        word: nextWord,
        reading: form.reading.trim(),
        meaning: form.meaning.trim(),
        example: form.example.trim(),
        note: form.note.trim(),
        partOfSpeech: form.partOfSpeech.trim(),
        sourceNoteId: form.sourceNoteId || null,
        folderId: form.folderId,
      })
      await reloadFolder()

      cancelEdit()
    } catch (error) {
      if (isDuplicateWordError(error)) {
        Modal.warning({
          title: t('folderDetail.duplicateTitle'),
          content: t('folderDetail.duplicateContent', { word: nextWord }),
          okText: t('folderDetail.gotIt'),
        })
      }
    }
  }

  const handleDelete = async (word: Word) => {
    const confirmed = window.confirm(t('folderDetail.deleteConfirm', { word: word.word }))
    if (!confirmed) return
    await useAppStore.getState().deleteWord(word.id)
    await reloadFolder()
  }

  // Sort comparator matching the server's orderBy on /api/folders/:id —
  // pinnedAt desc, then createdAt desc. Used to re-position the word locally
  // after a pin so we don't have to refetch the whole folder.
  const sortByPinThenCreated = (a: Word, b: Word) => {
    const ap = a.pinnedAt ? new Date(a.pinnedAt).getTime() : 0
    const bp = b.pinnedAt ? new Date(b.pinnedAt).getTime() : 0
    if (ap !== bp) return bp - ap
    const ac = a.createdAt ? new Date(a.createdAt).getTime() : 0
    const bc = b.createdAt ? new Date(b.createdAt).getTime() : 0
    return bc - ac
  }

  const pinToTop = async (word: Word) => {
    // Bypass the store's updateWord — that path auto-refetches the whole
    // folder. We patch local state from the PATCH response instead, so
    // spamming 置顶 only fires one small request per click instead of two
    // full-folder GETs. In-flight guard rejects re-clicks on the same row.
    if (pinningId === word.id) return
    setPinningId(word.id)
    try {
      const updated = await updateWordApi(word.id, { isPinned: true })
      setFolder((prev) => {
        if (!prev) return prev
        const nextWords = prev.words
          .map((w) => (w.id === updated.id ? updated : w))
          .sort(sortByPinThenCreated)
        return { ...prev, words: nextWords }
      })
    } finally {
      setPinningId(null)
    }
  }

  const openBatchModal = () => {
    setBatchInput('')
    setBatchResults([])
    setIsBatchOpen(true)
  }

  const pinExistingFromBatch = async (rowIdx: number, wordId: string) => {
    // Same path as pinToTop — direct API + local patch, no folder refetch.
    if (pinningId === wordId) return
    setPinningId(wordId)
    try {
      const updated = await updateWordApi(wordId, { isPinned: true })
      setFolder((prev) => {
        if (!prev) return prev
        const nextWords = prev.words
          .map((w) => (w.id === updated.id ? updated : w))
          .sort(sortByPinThenCreated)
        return { ...prev, words: nextWords }
      })
      setBatchResults((prev) =>
        prev.map((r, idx) =>
          idx === rowIdx ? { ...r, status: 'success', message: '已置顶' } : r,
        ),
      )
    } catch {
      setBatchResults((prev) =>
        prev.map((r, idx) =>
          idx === rowIdx ? { ...r, message: '置顶失败' } : r,
        ),
      )
    } finally {
      setPinningId(null)
    }
  }

  // Try to add one word: AI-fill → create. Returns the outcome as a discriminated
  // union so callers (batch, retry, single-add) can uniformly branch on status.
  // Shared to avoid drift between the batch loop and the retry loop.
  const addOneWord = async (
    word: string,
  ): Promise<
    | { status: 'success' }
    | { status: 'duplicate'; message: string; existingWordId?: string }
    | { status: 'failed'; message: string }
  > => {
    if (!folder) return { status: 'failed', message: 'folder not ready' }
    let filled: Awaited<ReturnType<typeof fillWordByAi>>
    try {
      filled = await fillWordByAi({
        word,
        language: folder.language as 'en' | 'jp',
        sourceLanguage: folder.language as 'en' | 'jp',
        targetLanguage: folder.language as 'en' | 'jp',
      })
    } catch {
      return { status: 'failed', message: 'AI 查询失败' }
    }
    try {
      await useAppStore.getState().createWord({
        word: filled.word || word,
        reading: filled.reading || '',
        meaning: filled.meaning || '',
        example: filled.example || '',
        note: filled.note || '',
        partOfSpeech: filled.partOfSpeech || '',
        language: folder.language,
        folderId: folder.id,
      })
      return { status: 'success' }
    } catch (err) {
      if (isDuplicateWordError(err)) {
        // Match either the raw user input OR the AI-normalized form, since
        // either could be what's in the DB.
        const existing = folder.words.find(
          (w) => w.word === word || (filled.word && w.word === filled.word),
        )
        return {
          status: 'duplicate',
          message: '已存在',
          existingWordId: existing?.id,
        }
      }
      return { status: 'failed', message: '保存失败' }
    }
  }

  const runBatchAdd = async () => {
    if (!folder) return
    // Split on commas / semicolons / dunhao / newlines ONLY — NOT spaces.
    // Many English entries are multi-word phrases ("zebra crossing", "give
    // up") and breaking on whitespace would shatter them. Internal spaces
    // are preserved; trim only strips edge whitespace.
    const raw = batchInput
      .split(/[,，；;、\r\n]+/u)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
    const items = Array.from(new Set(raw))
    if (items.length === 0) return

    setBatchRunning(true)
    setBatchResults(items.map((w) => ({ word: w, status: 'pending' as const })))

    const updateOne = (
      i: number,
      patch: Partial<{
        status: 'pending' | 'running' | 'success' | 'duplicate' | 'failed'
        message: string
        existingWordId: string
      }>,
    ) => {
      setBatchResults((prev) =>
        prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)),
      )
    }

    // Serial — keeps AI rate limits + budget happy; user sees one-by-one
    // progress which feels honest about long runs.
    const failedThisRun: Array<{ word: string; message: string }> = []
    for (let i = 0; i < items.length; i++) {
      const word = items[i]
      updateOne(i, { status: 'running' })
      const outcome = await addOneWord(word)
      updateOne(i, outcome)
      if (outcome.status === 'failed') {
        failedThisRun.push({ word, message: outcome.message })
      }
    }

    setBatchRunning(false)
    await reloadFolder()

    // Auto-open the retry panel if any words failed. The user asked for this
    // to appear right after batch completion — one-click retry saves them
    // from re-typing / re-pasting the failed words.
    if (failedThisRun.length > 0) {
      setRetryItems(
        failedThisRun.map((f) => ({
          word: f.word,
          message: f.message,
          status: 'idle',
        })),
      )
      setIsRetryOpen(true)
    }
  }

  const runRetry = async () => {
    if (!folder) return
    setRetryRunning(true)
    // Snapshot the current pending indexes so index shifts (removals) don't
    // break the loop — we iterate over word text, updating by index each turn.
    const targets = retryItems
      .map((item, idx) => ({ ...item, idx }))
      .filter((it) => it.status === 'idle' || it.status === 'failed')

    for (const t of targets) {
      setRetryItems((prev) =>
        prev.map((r, idx) => (idx === t.idx ? { ...r, status: 'running' } : r)),
      )
      const outcome = await addOneWord(t.word)
      setRetryItems((prev) =>
        prev.map((r, idx) => {
          if (idx !== t.idx) return r
          if (outcome.status === 'success') {
            return { ...r, status: 'success', message: '' }
          }
          if (outcome.status === 'duplicate') {
            return { ...r, status: 'success', message: '已存在' }
          }
          return { ...r, status: 'failed', message: outcome.message }
        }),
      )
    }

    setRetryRunning(false)
    await reloadFolder()
  }

  return (
    <section className="page">
      <div className="section-header">
        <div>
          <p className="eyebrow">
            <Link to="/folders">{t('folderDetail.back')}</Link>
          </p>
          <h2>
            {folder ? folder.name : t('folderDetail.title')}
            {folder ? (
              <span className="folder-language tag-inline">
                {folder.language.toUpperCase()}
              </span>
            ) : null}
          </h2>
          <p className="muted">
            {t('folderDetail.totalWords', { count: words.length })}
            {todayNewCount > 0 ? (
              <>
                {' · '}
                <span className="folder-today-new">
                  {t('folderDetail.todayNew', { count: todayNewCount })}
                </span>
              </>
            ) : null}
          </p>
          <div className="session-picker">
            <span className="session-picker-label">
              {t('folderDetail.progress', {
                learned: learnedWords.length,
                total: words.length,
                percent: learnedPercent,
              })}
            </span>
            <div className="progress-track home-progress-track">
              <span className="progress-bar" style={{ width: `${learnedPercent}%` }} />
            </div>
          </div>
          <div className="compact-actions">
            <button
              type="button"
              className={filter === 'all' ? 'primary-button' : 'secondary-button'}
              onClick={() => setFilter('all')}
            >
              {t('folderDetail.filterAll', { count: words.length })}
            </button>
            <button
              type="button"
              className={filter === 'learned' ? 'primary-button' : 'secondary-button'}
              onClick={() => setFilter('learned')}
            >
              {t('folderDetail.filterLearned', { count: learnedWords.length })}
            </button>
            <button
              type="button"
              className={filter === 'unlearned' ? 'primary-button' : 'secondary-button'}
              onClick={() => setFilter('unlearned')}
            >
              {t('folderDetail.filterUnlearned', { count: unlearnedWords.length })}
            </button>
          </div>
          <div className="word-search-form">
            <Input
              value={searchKeyword}
              onChange={(event) => setSearchKeyword(event.target.value)}
              placeholder="搜索已添加单词：单词/释义/例句/笔记"
              allowClear
            />
          </div>
        </div>
        <div className="hero-actions compact-actions">
          <Link
            className="primary-link"
            to={`/words/new${folder ? `?folderId=${folder.id}` : ''}`}
          >
            {t('folderDetail.addWord')}
          </Link>
          <button
            type="button"
            className="secondary-link"
            disabled={!folder}
            onClick={openBatchModal}
            title="粘贴多个词,AI 自动查并加到本分类"
          >
            批量添加
          </button>
          {folder && words.length > 0 ? (
            <a
              className="secondary-link"
              href={`/api/words/export?folderId=${folder.id}`}
              download
            >
              {t('folderDetail.exportCsv')}
            </a>
          ) : null}
        </div>
      </div>

      {folder ? <VoicePicker lang={folder.language} /> : null}

      {isLoadingFolder ? <div className="card">{t('folderDetail.loading')}</div> : null}
      {error ? <p className="error-text">{error}</p> : null}

      {!isLoadingFolder && folder && filteredWords.length === 0 ? (
        <div className="card empty-state">
          <p>
            {words.length === 0
              ? t('folderDetail.emptyNoWords')
              : filter === 'learned'
                ? t('folderDetail.emptyNoLearned')
                : t('folderDetail.emptyNoUnlearned')}
          </p>
        </div>
      ) : null}

      <div className="word-list word-list-folder">
        {pagedWords.map((word) => (
            <article
              key={word.id}
              id={`word-${word.id}`}
              className={`card word-card word-card-folder ${
                highlightedWordId === word.id ? 'is-highlighted' : ''
              }`}
            >
              <div className="word-card-header">
                <div>
                  <div className="word-card-title">
                    <strong className="word-title">{word.word}</strong>
                    <SpeakButton
                      text={word.word} reading={word.reading}
                      lang={word.language}
                      size="md"
                      label={t('folderDetail.formWord')}
                    />
                    <span className="muted word-reading">{word.reading}</span>
                  </div>
                  <div className="word-status-row">
                    <Tag color={getMasteryColor(getMasteryStatus(word.review))}>
                      {getMasteryLabel(getMasteryStatus(word.review))}
                    </Tag>
                    {isTrickyWord(word.review) ? <Tag color="red">{t('folderDetail.tricky')}</Tag> : null}
                  </div>
                </div>
                <div className="folder-card-actions">
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => void pinToTop(word)}
                    disabled={pinningId === word.id}
                    title="把这个词放到第一个"
                  >
                    置顶
                  </button>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => beginEdit(word)}
                  >
                    {t('folderDetail.edit')}
                  </button>
                  <button
                    type="button"
                    className="ghost-button danger"
                    onClick={() => void handleDelete(word)}
                    disabled={isSubmitting}
                  >
                    {t('folderDetail.delete')}
                  </button>
                </div>
              </div>
              {word.meaning ? (
                <p className="word-meaning">{word.meaning}</p>
              ) : null}
              {word.partOfSpeech ? (
                <p className="muted">{t('folderDetail.posLabel', { value: word.partOfSpeech })}</p>
              ) : null}
              {word.review && hasLearnedProgress(word) ? (
                <div className="word-mastery-panel">
                  <p className="muted">{t('folderDetail.masteryPercent', { percent: getMasteryPercent(word.review) })}</p>
                  <p className="muted">
                    {t('folderDetail.nextReview', {
                      label: formatDueLabel(word.review.nextReviewDate, t),
                    })}
                  </p>
                  <details>
                    <summary>{t('folderDetail.masteryDetail')}</summary>
                    <p className="muted">
                      {t('folderDetail.recentRatings', {
                        value: formatRecentRatings(word.review.recentRatings, t),
                      })}
                    </p>
                    <p className="muted">
                      {t('folderDetail.lastRating', {
                        value: word.review.lastRating || t('folderDetail.none'),
                      })}
                    </p>
                  </details>
                </div>
              ) : null}
              {word.sourceNote ? (
                <p className="muted">
                  {t('folderDetail.sourceNote')}
                  <Link to={`/notes/${word.sourceNote.id}`}> {word.sourceNote.title}</Link>
                </p>
              ) : null}
              {word.example ? (
                <div className="word-example-block">
                  <div className="word-example-body">
                    <span className="word-example-label">{t('folderDetail.exampleLabel')}</span>
                    <p className="word-example-text">{word.example}</p>
                  </div>
                  <SpeakButton
                    text={word.example}
                    lang={word.language}
                    label={t('folderDetail.exampleLabel')}
                  />
                </div>
              ) : null}
              {word.note ? (
                <p className="muted word-note-text">{t('folderDetail.noteLabel', { value: word.note })}</p>
              ) : null}
            </article>
          ),
        )}
      </div>
      {filteredWords.length > 0 ? (
        <div className="folder-pagination">
          <Pagination
            current={safePage}
            pageSize={PAGE_SIZE}
            total={filteredWords.length}
            onChange={(nextPage) => {
              setPage(nextPage)
              window.scrollTo({ top: 0, behavior: 'smooth' })
            }}
            showSizeChanger={false}
            showTotal={(total) => t('folderDetail.paginationTotal', { total })}
          />
        </div>
      ) : null}

      <Modal
        open={editingWordId !== null && form !== null}
        onCancel={cancelEdit}
        title={
          editingWordId
            ? words.find((w) => w.id === editingWordId)?.word ?? t('folderDetail.edit')
            : t('folderDetail.edit')
        }
        width={720}
        destroyOnHidden
        footer={null}
        styles={{ body: { maxHeight: '70vh', overflowY: 'auto' } }}
      >
        {form && editingWordId ? (
          <form
            className="word-edit"
            onSubmit={(event) => handleSave(event, editingWordId)}
          >
            <div className="word-grid">
              <label className="form-field">
                <span>{t('folderDetail.formWord')}</span>
                <Input
                  value={form.word}
                  onChange={(event) =>
                    setForm((prev) =>
                      prev ? { ...prev, word: event.target.value } : prev,
                    )
                  }
                />
              </label>
              <label className="form-field">
                <span>{t('folderDetail.formReading')}</span>
                <Input
                  value={form.reading}
                  onChange={(event) =>
                    setForm((prev) =>
                      prev ? { ...prev, reading: event.target.value } : prev,
                    )
                  }
                />
              </label>
              <label className="form-field form-field-full">
                <span>{t('folderDetail.formFolder')}</span>
                <Select
                  value={form.folderId || undefined}
                  disabled={isLoadingFolders}
                  onChange={(v) =>
                    setForm((prev) =>
                      prev ? { ...prev, folderId: v ?? '' } : prev,
                    )
                  }
                  placeholder={t('folderDetail.formChooseFolder')}
                  options={folderList.map((item) => ({
                    value: item.id,
                    label: `${item.name} (${item.language})`,
                  }))}
                />
              </label>
              <label className="form-field form-field-full">
                <span>{t('folderDetail.formSourceNote')}</span>
                <Select
                  value={form.sourceNoteId || undefined}
                  onChange={(v) =>
                    setForm((prev) =>
                      prev ? { ...prev, sourceNoteId: v ?? '' } : prev,
                    )
                  }
                  placeholder={t('folderDetail.formNoSource')}
                  allowClear
                  options={noteOptions.map((item) => ({
                    value: item.id,
                    label: item.title,
                  }))}
                />
              </label>
              <label className="form-field form-field-full">
                <span>{t('folderDetail.formPartOfSpeech')}</span>
                <Input
                  value={form.partOfSpeech}
                  onChange={(event) =>
                    setForm((prev) =>
                      prev ? { ...prev, partOfSpeech: event.target.value } : prev,
                    )
                  }
                  placeholder={t('folderDetail.formPosPlaceholder')}
                />
              </label>
              <label className="form-field form-field-full">
                <span>{t('folderDetail.formMeaning')}</span>
                <Input.TextArea
                  rows={3}
                  value={form.meaning}
                  onChange={(event) =>
                    setForm((prev) =>
                      prev ? { ...prev, meaning: event.target.value } : prev,
                    )
                  }
                />
              </label>
              <label className="form-field form-field-full">
                <span>{t('folderDetail.formExample')}</span>
                <Input.TextArea
                  rows={2}
                  value={form.example}
                  onChange={(event) =>
                    setForm((prev) =>
                      prev ? { ...prev, example: event.target.value } : prev,
                    )
                  }
                />
              </label>
              <label className="form-field form-field-full">
                <span>{t('folderDetail.formNote')}</span>
                <Input.TextArea
                  rows={2}
                  value={form.note}
                  onChange={(event) =>
                    setForm((prev) =>
                      prev ? { ...prev, note: event.target.value } : prev,
                    )
                  }
                />
              </label>
            </div>
            <div className="form-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={cancelEdit}
              >
                {t('folderDetail.cancel')}
              </button>
              <button
                type="submit"
                className="primary-button"
                disabled={isSubmitting}
              >
                {t('folderDetail.save')}
              </button>
            </div>
          </form>
        ) : null}
      </Modal>

      <Modal
        title="批量添加单词"
        open={isBatchOpen}
        onCancel={() => {
          if (batchRunning) return
          setIsBatchOpen(false)
        }}
        footer={null}
        width={520}
        maskClosable={!batchRunning}
        closable={!batchRunning}
      >
        {batchResults.length === 0 ? (
          <>
            <p className="muted" style={{ marginTop: 0 }}>
              用逗号、空格或换行分隔多个词。AI 会逐个查并加到当前分类。
            </p>
            <Input.TextArea
              value={batchInput}
              onChange={(e) => setBatchInput(e.target.value)}
              placeholder={'例如:\n勉強\n頑張る、励まし'}
              rows={8}
              autoSize={{ minRows: 6, maxRows: 20 }}
            />
            <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                type="button"
                className="ghost-button"
                onClick={() => setIsBatchOpen(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={!batchInput.trim()}
                onClick={() => void runBatchAdd()}
              >
                开始添加
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="muted" style={{ marginTop: 0 }}>
              {batchRunning
                ? `处理中:${batchResults.filter((r) => r.status === 'success' || r.status === 'duplicate' || r.status === 'failed').length} / ${batchResults.length}`
                : `完成。成功 ${batchResults.filter((r) => r.status === 'success').length} · 已存在 ${batchResults.filter((r) => r.status === 'duplicate').length} · 失败 ${batchResults.filter((r) => r.status === 'failed').length}`}
            </p>
            <ul
              style={{
                listStyle: 'none',
                padding: 0,
                margin: 0,
                maxHeight: 360,
                overflowY: 'auto',
              }}
            >
              {batchResults.map((r, i) => (
                <li
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '6px 0',
                    borderBottom: '1px solid rgba(0,0,0,0.04)',
                    fontSize: 14,
                  }}
                >
                  <span style={{ width: 22, textAlign: 'center' }}>
                    {r.status === 'pending'
                      ? '⏳'
                      : r.status === 'running'
                        ? '🌀'
                        : r.status === 'success'
                          ? '✅'
                          : r.status === 'duplicate'
                            ? '⚠️'
                            : '❌'}
                  </span>
                  <span style={{ flex: 1, fontFamily: 'inherit' }}>{r.word}</span>
                  {r.message ? (
                    <span className="muted" style={{ fontSize: 12 }}>
                      {r.message}
                    </span>
                  ) : null}
                  {r.status === 'duplicate' && r.existingWordId ? (
                    <button
                      type="button"
                      className="ghost-button"
                      style={{ fontSize: 12, padding: '2px 10px', borderRadius: 999 }}
                      onClick={() => void pinExistingFromBatch(i, r.existingWordId!)}
                      disabled={pinningId === r.existingWordId}
                      title="把这个已存在的词置顶到分类第一个"
                    >
                      置顶
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
            {!batchRunning ? (
              <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => {
                    setIsBatchOpen(false)
                    setBatchInput('')
                    setBatchResults([])
                  }}
                >
                  完成
                </button>
              </div>
            ) : null}
          </>
        )}
      </Modal>

      <Modal
        open={isRetryOpen}
        onCancel={() => {
          if (retryRunning) return
          setIsRetryOpen(false)
        }}
        title={`添加失败 ${retryItems.filter((r) => r.status === 'failed' || r.status === 'idle').length} 个`}
        maskClosable={!retryRunning}
        closable={!retryRunning}
        footer={null}
      >
        <p className="muted" style={{ marginTop: 0 }}>
          这些词在批量添加时失败(通常是 AI 网络抖动或临时错误),点"一键重试"重新查询 + 保存。
        </p>
        <ul className="retry-list">
          {retryItems.map((r, i) => (
            <li key={`${r.word}-${i}`} className="retry-list-item">
              <span className="retry-list-icon" aria-hidden>
                {r.status === 'running'
                  ? '⏳'
                  : r.status === 'success'
                    ? '✅'
                    : r.status === 'failed'
                      ? '❌'
                      : '·'}
              </span>
              <span className="retry-list-word">{r.word}</span>
              {r.message ? (
                <span className="muted retry-list-msg">{r.message}</span>
              ) : null}
            </li>
          ))}
        </ul>
        <div className="retry-list-actions">
          <button
            type="button"
            className="primary-button"
            onClick={() => void runRetry()}
            disabled={
              retryRunning ||
              retryItems.filter((r) => r.status === 'idle' || r.status === 'failed')
                .length === 0
            }
          >
            {retryRunning
              ? '重试中…'
              : `一键重试 (${retryItems.filter((r) => r.status === 'idle' || r.status === 'failed').length})`}
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={() => {
              if (retryRunning) return
              setIsRetryOpen(false)
            }}
            disabled={retryRunning}
          >
            关闭
          </button>
        </div>
      </Modal>
    </section>
  )
}
