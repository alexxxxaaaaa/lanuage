import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Modal } from 'antd'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { fillWordByAi } from '../api/ai'
import { getErrorMessage, isDuplicateWordError } from '../api/error'
import { useI18n } from '../i18n'
import { getNotes } from '../api/notes'
import { useAppStore } from '../store/useAppStore'

const initialForm = {
  folderId: '',
  sourceNoteId: '',
  word: '',
  reading: '',
  meaning: '',
  example: '',
  note: '',
  partOfSpeech: '',
}

type FolderLanguage = 'en' | 'jp'

function pickFolderByLanguage(
  folders: Array<{ id: string; language: FolderLanguage }>,
  language: FolderLanguage,
  currentFolderId: string,
) {
  const sameLanguage = folders.filter((item) => item.language === language)
  if (sameLanguage.length === 0) return ''
  if (sameLanguage.some((item) => item.id === currentFolderId)) return currentFolderId
  return sameLanguage[0].id
}

export function AddWordPage() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const prefillFolderId = searchParams.get('folderId') ?? ''
  const prefillNoteId = searchParams.get('noteId') ?? ''
  const folders = useAppStore((state) => state.folders)
  const isLoadingFolders = useAppStore((state) => state.isLoadingFolders)
  const isSubmitting = useAppStore((state) => state.isSubmitting)
  const error = useAppStore((state) => state.error)
  const folderList = useMemo(
    () => (Array.isArray(folders) ? folders : []),
    [folders],
  )

  const [form, setForm] = useState({ ...initialForm, folderId: prefillFolderId })
  const [aiTerm, setAiTerm] = useState('')
  const [noteOptions, setNoteOptions] = useState<Array<{ id: string; title: string }>>([])
  const [isFillingByAi, setIsFillingByAi] = useState(false)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const selectedFolder = useMemo(
    () => folderList.find((folder) => folder.id === form.folderId),
    [folderList, form.folderId],
  )
  const wordInputRef = useRef<HTMLInputElement>(null)
  const successTimerRef = useRef<number | null>(null)

  useEffect(() => {
    useAppStore.getState().clearError()
    void useAppStore.getState().fetchFolders()
    void getNotes().then((rows) =>
      setNoteOptions((rows ?? []).map((item) => ({ id: item.id, title: item.title }))),
    )
    return () => {
      if (successTimerRef.current !== null) {
        window.clearTimeout(successTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (prefillFolderId) {
      setForm((current) => ({ ...current, folderId: prefillFolderId }))
    }
  }, [prefillFolderId])

  useEffect(() => {
    if (prefillNoteId) {
      setForm((current) => ({ ...current, sourceNoteId: prefillNoteId }))
    }
  }, [prefillNoteId])

  const showSuccess = (message: string) => {
    setSuccessMessage(message)
    if (successTimerRef.current !== null) {
      window.clearTimeout(successTimerRef.current)
    }
    successTimerRef.current = window.setTimeout(() => {
      setSuccessMessage(null)
      successTimerRef.current = null
    }, 2500)
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!selectedFolder) {
      Modal.warning({
        title: t('addWord.warningNoFolderTitle'),
        content: t('addWord.warningNoFolderContent'),
        okText: t('addWord.gotIt'),
      })
      return
    }

    const savedWord = form.word

    try {
      await useAppStore.getState().createWord({
        folderId: form.folderId,
        sourceNoteId: form.sourceNoteId || undefined,
        word: form.word,
        reading: form.reading,
        meaning: form.meaning,
        example: form.example,
        note: form.note,
        language: selectedFolder.language,
        partOfSpeech: form.partOfSpeech,
      })

      setForm((current) => ({
        ...initialForm,
        folderId: current.folderId,
        sourceNoteId: current.sourceNoteId,
      }))
      showSuccess(t('addWord.success', { word: savedWord }))
      wordInputRef.current?.focus()
    } catch (error) {
      if (isDuplicateWordError(error)) {
        Modal.warning({
          title: t('addWord.duplicateTitle'),
          content: t('addWord.duplicateContent', { word: savedWord }),
          okText: t('addWord.gotIt'),
        })
      }
      // Error state is already handled in Zustand.
    }
  }

  const handleAiFill = async (extended = false) => {
    const term = aiTerm.trim() || form.word.trim()
    if (!term) {
      Modal.warning({
        title: t('addWord.warningInputTitle'),
        content: t('addWord.warningInputContent'),
        okText: t('addWord.gotIt'),
      })
      return
    }
    setIsFillingByAi(true)
    try {
      const result = await fillWordByAi({ word: term, extended })
      const nextFolderId = pickFolderByLanguage(folderList, result.language, form.folderId)
      if (!nextFolderId) {
        Modal.warning({
          title: t('addWord.warningNoLangFolderTitle'),
          content: t('addWord.warningNoLangFolderContent', {
            language: result.language === 'jp' ? t('expression.japanese') : t('expression.english'),
          }),
          okText: t('addWord.gotIt'),
        })
      }
      setForm((current) => ({
        ...current,
        folderId: nextFolderId,
        word: result.word || current.word,
        reading: result.reading || current.reading,
        meaning: result.meaning || current.meaning,
        example: result.example || current.example,
        note: result.note || current.note,
        partOfSpeech: result.partOfSpeech || current.partOfSpeech,
      }))
      setAiTerm('')
    } catch (error) {
      Modal.confirm({
        title: t('addWord.aiFailedTitle'),
        content: getErrorMessage(error, t('addWord.aiFailedContent')),
        okText: extended ? t('addWord.retry') : t('addWord.retryExtended'),
        cancelText: t('addWord.gotIt'),
        onOk: () => handleAiFill(true),
      })
    } finally {
      setIsFillingByAi(false)
    }
  }

  return (
    <section className="page">
      <div className="card">
        <p className="eyebrow">New Word</p>
        <h2>{t('addWord.title')}</h2>

        <form className="word-form" onSubmit={(event) => void handleSubmit(event)}>
          <label>
            {t('addWord.aiFill')} <span className="optional-mark">{t('addWord.optional')}</span>
            <div className="dict-lookup-row">
              <input
                value={aiTerm}
                onChange={(event) => setAiTerm(event.target.value)}
                placeholder={t('addWord.aiPlaceholder')}
              />
            
              <button
                type="button"
                className="secondary-button"
                onClick={() => void handleAiFill()}
                disabled={isFillingByAi}
              >
                {isFillingByAi ? t('addWord.aiFilling') : t('addWord.aiFillButton')}
              </button>
            </div>
          </label>
          {selectedFolder ? (
            <p className="muted">{t('addWord.matchedFolder', { name: selectedFolder.name })}</p>
          ) : null}
          <label>
            {t('addWord.sourceNote')} <span className="optional-mark">{t('addWord.optional')}</span>
            <select
              value={form.sourceNoteId}
              onChange={(event) =>
                setForm((current) => ({ ...current, sourceNoteId: event.target.value }))
              }
            >
              <option value="">{t('addWord.noSourceNote')}</option>
              {noteOptions.map((note) => (
                <option key={note.id} value={note.id}>
                  {note.title}
                </option>
              ))}
            </select>
          </label>
          {!isLoadingFolders && folderList.length === 0 ? (
            <p className="error-text">
              {t('addWord.noFolder')}
              <button
                type="button"
                className="link-button"
                onClick={() => navigate('/folders')}
              >
                {t('addWord.folderPage')}
              </button>
              {t('addWord.createFolderHint')}
            </p>
          ) : null}

          <label>
            {t('addWord.word')} <span className="required-mark">*</span>
            <input
              ref={wordInputRef}
              value={form.word}
              onChange={(event) =>
                setForm((current) => ({ ...current, word: event.target.value }))
              }
              
              required
            />
          </label>

          <label>
            {t('addWord.reading')} <span className="required-mark">*</span>
            <input
              value={form.reading}
              onChange={(event) =>
                setForm((current) => ({ ...current, reading: event.target.value }))
              }
              
              required
            />
          </label>

          <label>
            {t('addWord.meaning')} <span className="optional-mark">{t('addWord.optional')}</span>
            <textarea
              value={form.meaning}
              onChange={(event) =>
                setForm((current) => ({ ...current, meaning: event.target.value }))
              }
              
              rows={3}
            />
          </label>

          <label>
            {t('addWord.example')} <span className="optional-mark">{t('addWord.optional')}</span>
            <textarea
              value={form.example}
              onChange={(event) =>
                setForm((current) => ({ ...current, example: event.target.value }))
              }
              
              rows={3}
            />
          </label>

          <label>
            {t('addWord.note')} <span className="optional-mark">{t('addWord.optional')}</span>
            <textarea
              value={form.note}
              onChange={(event) =>
                setForm((current) => ({ ...current, note: event.target.value }))
              }
              placeholder={t('addWord.notePlaceholder')}
              rows={3}
            />
          </label>

          <label>
            {t('addWord.partOfSpeech')} <span className="optional-mark">{t('addWord.optional')}</span>
            <input
              value={form.partOfSpeech}
              onChange={(event) =>
                setForm((current) => ({ ...current, partOfSpeech: event.target.value }))
              }
              placeholder={t('addWord.posPlaceholder')}
            />
          </label>

          <div className="form-actions">
            <button type="submit" disabled={isSubmitting || isLoadingFolders}>
              {isSubmitting ? t('addWord.saving') : t('addWord.save')}
            </button>
            {selectedFolder ? (
              <button
                type="button"
                className="secondary-button"
                onClick={() => navigate(`/folders/${selectedFolder.id}`)}
              >
                {t('addWord.viewFolder')}
              </button>
            ) : null}
          </div>

          {successMessage ? (
            <p className="success-text">{successMessage}</p>
          ) : null}
          {error ? <p className="error-text">{error}</p> : null}
        </form>
      </div>
    </section>
  )
}
