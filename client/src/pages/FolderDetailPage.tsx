import { useEffect, useState } from 'react'
import { Input, Tag } from 'antd'
import { Modal } from 'antd'
import { Pagination } from 'antd'
import { Link, useLocation, useParams } from 'react-router-dom'
import { isDuplicateWordError } from '../api/error'
import { useI18n } from '../i18n'
import { getNotes } from '../api/notes'
import { SpeakButton } from '../components/SpeakButton'
import { VoicePicker } from '../components/VoicePicker'
import { useAppStore } from '../store/useAppStore'
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
  const PAGE_SIZE = 12
  const { id } = useParams<{ id: string }>()
  const location = useLocation()
  const [highlightedWordId, setHighlightedWordId] = useState<string | null>(null)
  const folders = useAppStore((state) => state.folders)
  const isLoadingFolders = useAppStore((state) => state.isLoadingFolders)
  const currentFolder = useAppStore((state) => state.currentFolder)
  const isLoadingFolder = useAppStore((state) => state.isLoadingFolder)
  const isSubmitting = useAppStore((state) => state.isSubmitting)
  const error = useAppStore((state) => state.error)

  const [editingWordId, setEditingWordId] = useState<string | null>(null)
  const [form, setForm] = useState<WordFormState | null>(null)
  const [filter, setFilter] = useState<'all' | 'learned' | 'unlearned'>('all')
  const [searchKeyword, setSearchKeyword] = useState('')
  const [page, setPage] = useState(1)
  const [noteOptions, setNoteOptions] = useState<Array<{ id: string; title: string }>>([])

  useEffect(() => {
    if (!id) return
    useAppStore.getState().clearError()
    void useAppStore.getState().fetchFolders()
    void useAppStore.getState().fetchFolderById(id)
    void getNotes().then((rows) =>
      setNoteOptions((rows ?? []).map((item) => ({ id: item.id, title: item.title })),
      ),
    )
    return () => {
      useAppStore.getState().clearCurrentFolder()
    }
  }, [id])

  if (!id) {
    return null
  }

  const folder = currentFolder && currentFolder.id === id ? currentFolder : null
  const folderList = Array.isArray(folders) ? folders : []
  const words = folder?.words ?? []
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
        {pagedWords.map((word) =>
          editingWordId === word.id && form ? (
            <form
              key={word.id}
              className="card word-card word-edit word-card-full"
              onSubmit={(event) => handleSave(event, word.id)}
            >
              <div className="word-grid">
                <label className="form-field">
                  <span>{t('folderDetail.formWord')}</span>
                  <input
                    value={form.word}
                    onChange={(event) =>
                      setForm((prev) =>
                        prev ? { ...prev, word: event.target.value } : prev,
                      )
                    }
                    required
                  />
                </label>
                <label className="form-field">
                  <span>{t('folderDetail.formReading')}</span>
                  <input
                    value={form.reading}
                    onChange={(event) =>
                      setForm((prev) =>
                        prev ? { ...prev, reading: event.target.value } : prev,
                      )
                    }
                    required
                  />
                </label>
                <label className="form-field form-field-full">
                  <span>{t('folderDetail.formFolder')}</span>
                  <select
                    value={form.folderId}
                    disabled={isLoadingFolders}
                    onChange={(event) =>
                      setForm((prev) =>
                        prev ? { ...prev, folderId: event.target.value } : prev,
                      )
                    }
                    required
                  >
                    <option value="">{t('folderDetail.formChooseFolder')}</option>
                    {folderList.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} ({item.language})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="form-field form-field-full">
                  <span>{t('folderDetail.formSourceNote')}</span>
                  <select
                    value={form.sourceNoteId}
                    onChange={(event) =>
                      setForm((prev) =>
                        prev ? { ...prev, sourceNoteId: event.target.value } : prev,
                      )
                    }
                  >
                    <option value="">{t('folderDetail.formNoSource')}</option>
                    {noteOptions.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.title}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="form-field form-field-full">
                  <span>{t('folderDetail.formPartOfSpeech')}</span>
                  <input
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
                  <textarea
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
                  <textarea
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
                  <textarea
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
                  type="submit"
                  className="primary-button"
                  disabled={isSubmitting}
                >
                  {t('folderDetail.save')}
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={cancelEdit}
                >
                  {t('folderDetail.cancel')}
                </button>
              </div>
            </form>
          ) : (
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
                      text={word.word}
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
    </section>
  )
}
