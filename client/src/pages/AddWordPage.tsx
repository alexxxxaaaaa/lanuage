import { useEffect, useMemo, useRef, useState } from 'react'
import { SelectField } from '../components/ui/SelectField'
import { Button, Input, ProgressBar, TextArea } from '@heroui/react'
import { confirm, alertDialog } from '../components/ui/dialog'
import type { FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
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

// localStorage key for "last folder I saved a word into". Restored on next
// AddWordPage mount so users don't have to re-pick every session. URL
// `?folderId=` and prefill precedence still win over this.
const LAST_FOLDER_KEY = 'add-word:last-folder-id'

function loadLastFolder(): string {
  if (typeof window === 'undefined') return ''
  try {
    return window.localStorage.getItem(LAST_FOLDER_KEY) ?? ''
  } catch {
    return ''
  }
}
function saveLastFolder(id: string) {
  if (typeof window === 'undefined') return
  try {
    if (id) window.localStorage.setItem(LAST_FOLDER_KEY, id)
  } catch {
    /* quota / privacy mode — ignore */
  }
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

  const [form, setForm] = useState({
    ...initialForm,
    // URL param wins; otherwise fall back to the last-saved folder from
    // localStorage. Validated against `folderList` once folders load, below.
    folderId: prefillFolderId || loadLastFolder(),
    sourceNoteId: prefillNoteId,
  })
  const [aiTerm, setAiTerm] = useState('')
  const [noteOptions, setNoteOptions] = useState<Array<{ id: string; title: string }>>([])
  const [isFillingByAi, setIsFillingByAi] = useState(false)
  const [aiProgress, setAiProgress] = useState(0)
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

  // The page stays mounted when the user follows another "add to this folder /
  // note" link, so re-apply the prefill whenever the URL params change. Doing
  // it during render (not in an effect) keeps it to a single render pass.
  const [appliedPrefill, setAppliedPrefill] = useState({
    folderId: prefillFolderId,
    noteId: prefillNoteId,
  })
  if (appliedPrefill.folderId !== prefillFolderId || appliedPrefill.noteId !== prefillNoteId) {
    setAppliedPrefill({ folderId: prefillFolderId, noteId: prefillNoteId })
    setForm((current) => ({
      ...current,
      folderId: prefillFolderId || current.folderId,
      sourceNoteId: prefillNoteId || current.sourceNoteId,
    }))
  }

  // Validate the persisted folder id once folders load — if the user deleted
  // that folder in another tab / session, drop the stale reference so the
  // Select shows its placeholder instead of a broken value.
  const hasFolders = !isLoadingFolders && folderList.length > 0
  if (hasFolders && form.folderId && !folderList.some((f) => f.id === form.folderId)) {
    setForm((current) => ({ ...current, folderId: '' }))
  }

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
      void alertDialog.warning({
        title: t('addWord.warningNoFolderTitle'),
        content: t('addWord.warningNoFolderContent'),
        okText: t('addWord.gotIt'),
      })
      return
    }

    const savedWord = form.word

    try {
      await useAppStore.getState().createWord({
        folderIds: [form.folderId],
        sourceNoteId: form.sourceNoteId || undefined,
        word: form.word,
        reading: form.reading,
        meaning: form.meaning,
        example: form.example,
        note: form.note,
        language: selectedFolder.language,
        partOfSpeech: form.partOfSpeech,
      })

      // Persist the folder we just saved into so the NEXT AddWordPage mount
      // (even in a fresh session) defaults to it.
      saveLastFolder(form.folderId)
      setForm((current) => ({
        ...initialForm,
        folderId: current.folderId,
        sourceNoteId: current.sourceNoteId,
      }))
      showSuccess(t('addWord.success', { word: savedWord }))
      wordInputRef.current?.focus()
    } catch (error) {
      if (isDuplicateWordError(error)) {
        void alertDialog.warning({
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
      void alertDialog.warning({
        title: t('addWord.warningInputTitle'),
        content: t('addWord.warningInputContent'),
        okText: t('addWord.gotIt'),
      })
      return
    }
    setIsFillingByAi(true)
    setAiProgress(8)
    // Simulate progress while waiting for AI — caps below 90% until response arrives.
    const progressTimer = window.setInterval(() => {
      setAiProgress((current) => {
        if (current >= 88) return current
        const delta = current < 50 ? 6 : current < 75 ? 3 : 1
        return Math.min(88, current + delta)
      })
    }, 400)
    try {
      // 这里的检测和 aiService 旧的 auto 规则一致：含假名或汉字 → 日语，否则
      // 英语。注意不能用查词页的 detectFromChars —— 它把纯汉字判成中文，
      // 而加词页语境下「勉強」这类词该按日语查定义，不是中→日翻译。
      const detected: 'en' | 'jp' = /[぀-ヿㇰ-ㇿ一-龯]/.test(term) ? 'jp' : 'en'
      const result = await fillWordByAi({
        word: term,
        sourceLanguage: detected,
        targetLanguage: detected,
        extended,
      })
      const nextFolderId = pickFolderByLanguage(folderList, result.language, form.folderId)
      if (!nextFolderId) {
        void alertDialog.warning({
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
      const retry = await confirm({
        title: t('addWord.aiFailedTitle'),
        content: getErrorMessage(error, t('addWord.aiFailedContent')),
        okText: extended ? t('addWord.retry') : t('addWord.retryExtended'),
        cancelText: t('addWord.gotIt'),
      })
      if (retry) void handleAiFill(true)
    } finally {
      window.clearInterval(progressTimer)
      setAiProgress(100)
      window.setTimeout(() => setAiProgress(0), 400)
      setIsFillingByAi(false)
    }
  }

  return (
    <section className="page">
      <div className="card">
        <h2>{t('addWord.title')}</h2>

        <form className="word-form" onSubmit={(event) => void handleSubmit(event)}>
          <label>
            {t('addWord.aiFill')} <span className="optional-mark">{t('addWord.optional')}</span>
            <div className="grid grid-cols-[minmax(0,1fr)_140px_auto] gap-2.5 max-sm:grid-cols-1">
              <Input
                value={aiTerm}
                onChange={(event) => setAiTerm(event.target.value)}
                placeholder={t('addWord.aiPlaceholder')}
                style={{ flex: 1 }}
              />
              <Button variant="outline"
                type="button"
                onPress={() => void handleAiFill()}
                isDisabled={isFillingByAi}
              >
                {isFillingByAi ? t('addWord.aiFilling') : t('addWord.aiFillButton')}
              </Button>
            </div>
            {isFillingByAi || aiProgress > 0 ? (
              <ProgressBar
                aria-label={t('addWord.aiFilling')}
                color={isFillingByAi ? 'accent' : 'success'}
                size="sm"
                value={aiProgress}
              >
                <ProgressBar.Track>
                  <ProgressBar.Fill />
                </ProgressBar.Track>
              </ProgressBar>
            ) : null}
          </label>
          <label>
            {t('addWord.folder')}
            <SelectField
              value={form.folderId || undefined}
              onChange={(v) =>
                setForm((current) => ({ ...current, folderId: v ?? '' }))
              }
              placeholder={t('addWord.pickFolder')}
              isDisabled={folderList.length === 0}
              options={folderList.map((folder) => ({
                value: folder.id,
                textValue: folder.name,
                label: (
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className="truncate">{folder.name}</span>
                    <span className="shrink-0 text-xs text-muted">
                      {folder.language === 'jp'
                        ? t('expression.japanese')
                        : t('expression.english')}
                    </span>
                  </span>
                ),
              }))}
            />
          </label>
          <label>
            {t('addWord.sourceNote')} <span className="optional-mark">{t('addWord.optional')}</span>
            <SelectField
              value={form.sourceNoteId || undefined}
              onChange={(v) =>
                setForm((current) => ({ ...current, sourceNoteId: v ?? '' }))
              }
              placeholder={t('addWord.noSourceNote')}
              options={noteOptions.map((note) => ({
                value: note.id,
                label: note.title.trim() || t('notes.untitled'),
              }))}
            />
          </label>
          {!isLoadingFolders && folderList.length === 0 ? (
            <p className="error-text">
              {t('addWord.noFolder')}
              <Button variant="ghost" size="sm" className="h-auto min-h-0 px-1 underline"
                type="button"
                onPress={() => navigate('/folders')}
              >
                {t('addWord.folderPage')}
              </Button>
              {t('addWord.createFolderHint')}
            </p>
          ) : null}

          <label>
            {t('addWord.word')} <span className="required-mark">*</span>
            <Input
              ref={wordInputRef}
              value={form.word}
              onChange={(event) =>
                setForm((current) => ({ ...current, word: event.target.value }))
              }
            />
          </label>

          <label>
            {t('addWord.reading')} <span className="required-mark">*</span>
            <Input
              value={form.reading}
              onChange={(event) =>
                setForm((current) => ({ ...current, reading: event.target.value }))
              }
            />
          </label>

          <label>
            {t('addWord.meaning')} <span className="optional-mark">{t('addWord.optional')}</span>
            <TextArea
              value={form.meaning}
              onChange={(event) =>
                setForm((current) => ({ ...current, meaning: event.target.value }))
              }
              rows={3}
            />
          </label>

          <label>
            {t('addWord.example')} <span className="optional-mark">{t('addWord.optional')}</span>
            <TextArea
              value={form.example}
              onChange={(event) =>
                setForm((current) => ({ ...current, example: event.target.value }))
              }
              rows={3}
            />
          </label>

          <label>
            {t('addWord.note')} <span className="optional-mark">{t('addWord.optional')}</span>
            <TextArea
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
            <Input
              value={form.partOfSpeech}
              onChange={(event) =>
                setForm((current) => ({ ...current, partOfSpeech: event.target.value }))
              }
              placeholder={t('addWord.posPlaceholder')}
            />
          </label>

          <div className="form-actions">
            <Button type="submit" isDisabled={isSubmitting || isLoadingFolders}>
              {isSubmitting ? t('addWord.saving') : t('addWord.save')}
            </Button>
            {selectedFolder ? (
              <Button variant="outline"
                type="button"
                onPress={() => navigate(`/folders/${selectedFolder.id}`)}
              >
                {t('addWord.viewFolder')}
              </Button>
            ) : null}
          </div>

          {successMessage ? (
            <p className="mx-0 mt-3 mb-0 rounded-[10px] bg-success-soft px-3.5 py-2.5 text-sm text-success-soft-foreground">{successMessage}</p>
          ) : null}
          {error ? <p className="error-text">{error}</p> : null}
        </form>
      </div>
    </section>
  )
}
