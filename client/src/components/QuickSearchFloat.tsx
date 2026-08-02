import { Search } from 'lucide-react'
import { SelectField } from './ui/SelectField'
import { Button, ProgressBar, toast } from '@heroui/react'
import { FloatButton } from './ui/FloatButton'
import { Modal } from './ui/Modal'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { fillWordByAi, type AiFillWordResult } from '../api/ai'
import { getErrorMessage, isDuplicateWordError } from '../api/error'
import { getWords } from '../api/words'
import { useI18n } from '../i18n'
import { useAppStore } from '../store/useAppStore'
import { SearchSuggest } from './SearchSuggest'
import { SpeakButton } from './SpeakButton'
import type { Word } from '../types'

const SEARCH_DEBOUNCE = 300

export function QuickSearchFloat() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const folders = useAppStore((state) => state.folders)
  const fetchFolders = useAppStore((state) => state.fetchFolders)
  const createWord = useAppStore((state) => state.createWord)
  const isSubmitting = useAppStore((state) => state.isSubmitting)

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [localResults, setLocalResults] = useState<Word[] | null>(null)
  const [isSearching, setIsSearching] = useState(false)
  const [aiResult, setAiResult] = useState<AiFillWordResult | null>(null)
  const [isAiSearching, setIsAiSearching] = useState(false)
  const [aiProgress, setAiProgress] = useState(0)
  const [targetFolderId, setTargetFolderId] = useState<string>('')

  const folderList = useMemo(
    () => (Array.isArray(folders) ? folders : []),
    [folders],
  )

  useEffect(() => {
    if (!open) return
    void fetchFolders()
  }, [open, fetchFolders])

  // Global hotkey: press `q` (lowercase, no modifiers) anywhere outside an
  // editable element to open the search popup.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'q' && e.key !== 'Q') return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const target = e.target as HTMLElement | null
      const tag = target?.tagName ?? ''
      const editable =
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        (target?.isContentEditable ?? false)
      if (editable) return
      if (open) return
      e.preventDefault()
      setOpen(true)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open])

  // The moment the query changes the previous round's results are stale. Reset
  // during render (React's documented way to react to a changed value) so the
  // old hits never get a frame on screen.
  const [searchedQuery, setSearchedQuery] = useState(query)
  if (searchedQuery !== query) {
    setSearchedQuery(query)
    setAiResult(null)
    setLocalResults(null)
    setIsSearching(query.trim().length > 0)
  }

  // Debounced local search
  useEffect(() => {
    const term = query.trim()
    if (!term) return
    const timer = setTimeout(async () => {
      try {
        const rows = await getWords({ q: term })
        setLocalResults(rows ?? [])
      } catch (error) {
        toast.danger(getErrorMessage(error, t('quickSearch.searchFailed')))
      } finally {
        setIsSearching(false)
      }
    }, SEARCH_DEBOUNCE)

    return () => clearTimeout(timer)
  }, [query, t])

  // Auto-pick a default target folder when an AI result arrives. Tracking the
  // result we already picked for means a later folder refresh won't overwrite
  // a folder the user chose by hand.
  const [pickedFor, setPickedFor] = useState<AiFillWordResult | null>(null)
  if (aiResult && folderList.length > 0 && pickedFor !== aiResult) {
    setPickedFor(aiResult)
    const sameLang = folderList.find((f) => f.language === aiResult.language)
    setTargetFolderId(sameLang?.id ?? folderList[0].id)
  }

  const handleAiSearch = async () => {
    const term = query.trim()
    if (!term) return
    setIsAiSearching(true)
    setAiProgress(8)
    const progressTimer = window.setInterval(() => {
      setAiProgress((current) => {
        if (current >= 88) return current
        const delta = current < 50 ? 6 : current < 75 ? 3 : 1
        return Math.min(88, current + delta)
      })
    }, 400)
    try {
      const result = await fillWordByAi({ word: term })
      setAiResult(result)
    } catch (error) {
      toast.danger(getErrorMessage(error, t('quickSearch.aiFailed')))
    } finally {
      window.clearInterval(progressTimer)
      setAiProgress(100)
      window.setTimeout(() => setAiProgress(0), 400)
      setIsAiSearching(false)
    }
  }

  const handleAdd = async () => {
    if (!aiResult) return
    if (!targetFolderId) {
      toast.warning(t('quickSearch.pickFolderFirst'))
      return
    }
    try {
      await createWord({
        folderId: targetFolderId,
        language: aiResult.language,
        word: aiResult.word,
        reading: aiResult.reading,
        meaning: aiResult.meaning,
        example: aiResult.example,
        note: aiResult.note,
        partOfSpeech: aiResult.partOfSpeech,
      })
      toast.success(t('quickSearch.added'))
      setAiResult(null)
      setQuery('')
      setOpen(false)
    } catch (error) {
      if (isDuplicateWordError(error)) {
        toast.warning(t('quickSearch.duplicate'))
        return
      }
      toast.danger(getErrorMessage(error, t('quickSearch.addFailed')))
    }
  }

  const close = () => {
    setOpen(false)
    setQuery('')
    setAiResult(null)
    setLocalResults(null)
  }

  const hasLocalHits = (localResults?.length ?? 0) > 0
  const noLocalHits = localResults !== null && localResults.length === 0
  const trimmed = query.trim()

  return (
    <>
      <FloatButton
        icon={<Search className="size-5" />}
        side="right"
        tooltip={t('quickSearch.tooltip')}
        variant="primary"
        onPress={() => setOpen(true)}
      />
      <Modal isOpen={open} size="lg" title={t('quickSearch.title')} onClose={close}>
        <div className="flex flex-col gap-3.5">
          <SearchSuggest
            value={query}
            onChange={setQuery}
            onSubmit={(text) => {
              const q = text.trim()
              if (!q) return
              close()
              navigate(`/words/search?q=${encodeURIComponent(q)}`)
            }}
            placeholder={t('quickSearch.placeholder')}
            inputClassName="w-full rounded-[10px] border border-border px-3.5 py-3 text-[15px] outline-none focus:border-accent focus:ring-3 focus:ring-accent/12"
            inlineDropdown
          />

          {!trimmed ? (
            <p className="muted m-0 text-[13px]">{t('quickSearch.hint')}</p>
          ) : null}

          {trimmed && isSearching ? (
            <p className="muted m-0 text-[13px]">{t('quickSearch.searching')}</p>
          ) : null}

          {hasLocalHits ? (
            <div className="flex flex-col gap-2">
              <p className="m-0 text-xs font-semibold tracking-[0.05em] text-slate-400 uppercase">
                {t('quickSearch.localTitle', { count: localResults!.length })}
              </p>
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                {localResults!.slice(0, 8).map((w) => (
                  <li key={w.id} className="rounded-[10px] border border-border bg-slate-50 px-3 py-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="text-base text-foreground">{w.word}</strong>
                      {w.reading ? <span className="muted">{w.reading}</span> : null}
                      <SpeakButton
                        text={w.word}
                        reading={w.reading}
                        lang={w.language}
                        size="sm"
                      />
                      <span className="ml-auto rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-slate-500">{w.folder?.name ?? ''}</span>
                    </div>
                    {w.meaning ? (
                      <p className="muted mt-1 mb-0 text-[13px]/[1.5]">{w.meaning}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {trimmed && !isSearching && noLocalHits && !aiResult ? (
            <div className="flex flex-col gap-2">
              <p className="muted m-0 text-[13px]">
                {t('quickSearch.noLocal', { term: trimmed })}
              </p>
              <Button className="self-start"
                type="button"
                onPress={() => void handleAiSearch()}
                isDisabled={isAiSearching}
              >
                {isAiSearching ? t('quickSearch.aiSearching') : t('quickSearch.aiSearch')}
              </Button>
              {isAiSearching || aiProgress > 0 ? (
                <ProgressBar
                  aria-label={t('quickSearch.aiSearching')}
                  color={isAiSearching ? 'accent' : 'success'}
                  size="sm"
                  value={aiProgress}
                >
                  <ProgressBar.Track>
                    <ProgressBar.Fill />
                  </ProgressBar.Track>
                </ProgressBar>
              ) : null}
            </div>
          ) : null}

          {aiResult ? (
            <div className="flex flex-col gap-2 rounded-xl border border-dashed border-accent bg-accent/4 px-3.5 py-3">
              <p className="m-0 text-xs font-semibold tracking-[0.05em] text-slate-400 uppercase">{t('quickSearch.aiResult')}</p>
              <div className="flex flex-wrap items-center gap-2">
                <strong className="text-base text-foreground">{aiResult.word}</strong>
                {aiResult.reading ? (
                  <span className="muted">{aiResult.reading}</span>
                ) : null}
                <SpeakButton
                  text={aiResult.word}
                  reading={aiResult.reading}
                  lang={aiResult.language}
                  size="sm"
                />
                {aiResult.partOfSpeech ? (
                  <span className="ml-auto rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-slate-500">
                    {aiResult.partOfSpeech}
                  </span>
                ) : null}
              </div>
              {aiResult.meaning ? (
                <p className="mt-1 mb-0 text-[13px]/[1.5] multiline-text">{aiResult.meaning}</p>
              ) : null}
              {aiResult.example ? (
                <p className="muted mt-1 mb-0 text-[13px]/[1.5] multiline-text">
                  {aiResult.example}
                </p>
              ) : null}
              {aiResult.note ? (
                <p className="muted mt-1 mb-0 text-xs">{aiResult.note}</p>
              ) : null}

              <div className="mt-3 flex gap-2 max-[480px]:flex-col">
                <SelectField
                  value={targetFolderId || undefined}
                  onChange={(v) => setTargetFolderId(v ?? '')}
                  placeholder={t('quickSearch.pickFolder')}
                  className="min-w-[180px] flex-1"
                  options={folderList
                    .filter((f) => f.language === aiResult.language)
                    .map((f) => ({ value: f.id, label: f.name }))}
                />
                <Button className="whitespace-nowrap max-[480px]:w-full"
                  type="button"
                  onPress={() => void handleAdd()}
                  isDisabled={isSubmitting || !targetFolderId}
                >
                  {isSubmitting ? t('quickSearch.adding') : t('quickSearch.add')}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </Modal>
     
    </>
  )
}
