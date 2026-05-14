import { useEffect, useMemo, useRef, useState } from 'react'
import { SoundOutlined } from '@ant-design/icons'
import { Link, useNavigate } from 'react-router-dom'
import { submitReviewResult } from '../api/review'
import { getTodayNewWords } from '../api/words'
import { SpeakButton } from '../components/SpeakButton'
import { useI18n } from '../i18n'
import { useAppStore } from '../store/useAppStore'
import type { ReviewRating, Word } from '../types'
import { speak, stopSpeaking } from '../utils/speech'

const BATCH_SIZE = 5
const RECOVERY_MAX_ATTEMPTS = 3

type Phase = 'study' | 'cloze' | 'recall' | 'recovery' | 'session-done'
type Status = 'idle' | 'correct' | 'wrong'

type BatchSummary = {
  word: string
  errors: number
  rating: ReviewRating
}

function katakanaToHiragana(value: string) {
  return value.replace(/[ァ-ヶ]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0x60),
  )
}

function normalizeAnswer(value: string) {
  return katakanaToHiragana(value.trim().toLowerCase()).replace(/\s+/g, ' ')
}

function isAnswerCorrect(typed: string, word: Word) {
  const candidate = normalizeAnswer(typed)
  if (!candidate) return false
  if (candidate === normalizeAnswer(word.word)) return true
  if (word.reading && candidate === normalizeAnswer(word.reading)) return true
  return false
}

/**
 * Parse stored example into one or more "target｜translation" pairs.
 * Returns the first usable pair, or null when nothing parseable.
 */
function pickExamplePair(example: string): { target: string; translation: string } | null {
  if (!example) return null
  const lines = example
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  for (const line of lines) {
    const parts = line.split(/[｜|]/)
    if (parts.length >= 1 && parts[0].trim()) {
      return {
        target: parts[0].trim(),
        translation: (parts[1] ?? '').trim(),
      }
    }
  }
  return null
}

/**
 * Replace the target word in a sentence with a blank. Case-insensitive,
 * word-boundary-aware for English; substring replace for CJK.
 * Returns null when the target word is not found.
 */
function buildCloze(sentence: string, word: string): string | null {
  const trimmed = word.trim()
  if (!trimmed) return null
  const isCjk = /[぀-ヿ一-龯]/.test(trimmed)
  const blank = '＿＿＿＿'
  if (isCjk) {
    const idx = sentence.indexOf(trimmed)
    if (idx === -1) return null
    return sentence.slice(0, idx) + blank + sentence.slice(idx + trimmed.length)
  }
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`\\b${escaped}\\b`, 'i')
  if (!re.test(sentence)) {
    // try without word boundary as a fallback (e.g. apostrophes)
    const re2 = new RegExp(escaped, 'i')
    if (!re2.test(sentence)) return null
    return sentence.replace(re2, blank)
  }
  return sentence.replace(re, blank)
}

function computeRating(errors: number): ReviewRating {
  if (errors === 0) return 'easy'
  if (errors === 1) return 'hard'
  return 'again'
}

function chunkInto<T>(items: T[], size: number): T[][] {
  if (items.length === 0) return []
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size))
  }
  return out
}

export function LearnPage() {
  const navigate = useNavigate()
  const { t } = useI18n()
  const reviewFolderId = useAppStore((state) => state.reviewFolderId)
  const sessionLimit = useAppStore((state) => state.sessionLimit)
  const todayReviews = useAppStore((state) => state.todayReviews)
  const dueCount = Array.isArray(todayReviews) ? todayReviews.length : 0

  const [allWords, setAllWords] = useState<Word[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Session state machine
  const [batchIdx, setBatchIdx] = useState(0)
  const [phase, setPhase] = useState<Phase>('study')
  const [itemIdx, setItemIdx] = useState(0)
  const [errorsByWord, setErrorsByWord] = useState<Record<string, number>>({})
  const [recoveryQueue, setRecoveryQueue] = useState<Word[]>([])
  const [recoveryAttempts, setRecoveryAttempts] = useState<Record<string, number>>({})
  const [typedAnswer, setTypedAnswer] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [usedHintByWord, setUsedHintByWord] = useState<Record<string, boolean>>({})
  const [sessionSummary, setSessionSummary] = useState<BatchSummary[]>([])
  const recallInputRef = useRef<HTMLInputElement | null>(null)

  const batches = useMemo(() => chunkInto(allWords, BATCH_SIZE), [allWords])
  const currentBatch = batches[batchIdx] ?? []
  const currentWord =
    phase === 'recovery'
      ? recoveryQueue[0]
      : currentBatch[itemIdx]

  const totalBatches = batches.length
  const overallProgress =
    allWords.length === 0
      ? 0
      : Math.round((sessionSummary.length / allWords.length) * 100)

  const folderName = useMemo(() => {
    if (!reviewFolderId) return t('home.all')
    const folders = useAppStore.getState().folders
    return folders.find((item) => item.id === reviewFolderId)?.name ?? t('home.all')
  }, [reviewFolderId, t])

  // Load words once per folder/limit change
  useEffect(() => {
    const run = async () => {
      setIsLoading(true)
      setError(null)
      try {
        const list = await getTodayNewWords(
          reviewFolderId ? { folderId: reviewFolderId } : undefined,
        )
        const safeList = Array.isArray(list) ? list : []
        const limited =
          sessionLimit === null ? safeList : safeList.slice(0, sessionLimit)
        setAllWords(limited)
        setBatchIdx(0)
        setPhase('study')
        setItemIdx(0)
        setErrorsByWord({})
        setRecoveryQueue([])
        setRecoveryAttempts({})
        setTypedAnswer('')
        setStatus('idle')
        setUsedHintByWord({})
        setSessionSummary([])
      } catch {
        setError(t('learn.loadFailed'))
      } finally {
        setIsLoading(false)
      }
    }
    void run()
  }, [reviewFolderId, sessionLimit])

  useEffect(() => {
    void useAppStore.getState().fetchTodayReviews()
  }, [reviewFolderId])

  // Reset typed answer on item change
  useEffect(() => {
    setTypedAnswer('')
    setStatus('idle')
  }, [phase, itemIdx, batchIdx, recoveryQueue[0]?.id])

  // Auto-focus the recall input when entering a test phase or advancing to next item.
  useEffect(() => {
    if (phase === 'cloze' || phase === 'recall' || phase === 'recovery') {
      if (status === 'idle') {
        // wait a tick for the input to mount/enable
        const id = window.setTimeout(() => recallInputRef.current?.focus(), 0)
        return () => window.clearTimeout(id)
      }
    }
  }, [phase, itemIdx, batchIdx, recoveryQueue[0]?.id, status])

  // Auto-speak word on study + when answer revealed
  useEffect(() => {
    if (!currentWord) return
    if (phase === 'study') {
      stopSpeaking()
      speak(currentWord.word, currentWord.language)
    }
  }, [phase, currentWord?.id])

  useEffect(() => {
    if (!currentWord) return
    if (status === 'correct' || status === 'wrong') {
      speak(currentWord.word, currentWord.language)
    }
  }, [status, currentWord?.id])

  // ----- transition helpers -----
  const advanceStudy = () => {
    if (itemIdx < currentBatch.length - 1) {
      setItemIdx(itemIdx + 1)
    } else {
      setItemIdx(0)
      setPhase('cloze')
    }
  }

  const advanceAfterTest = () => {
    if (itemIdx < currentBatch.length - 1) {
      setItemIdx(itemIdx + 1)
      return
    }
    // end of this stage; pick next stage
    if (phase === 'cloze') {
      setItemIdx(0)
      setPhase('recall')
      return
    }
    if (phase === 'recall') {
      // build recovery queue from words with any errors
      const queue = currentBatch.filter((w) => (errorsByWord[w.id] ?? 0) > 0)
      if (queue.length === 0) {
        void finishBatch()
      } else {
        setRecoveryQueue(queue)
        setRecoveryAttempts({})
        setPhase('recovery')
      }
    }
  }

  const advanceRecovery = (wasCorrect: boolean) => {
    if (!currentWord) return
    const wid = currentWord.id
    const prevAttempts = recoveryAttempts[wid] ?? 0
    const nextAttempts = prevAttempts + 1
    setRecoveryAttempts((prev) => ({ ...prev, [wid]: nextAttempts }))
    if (wasCorrect) {
      // remove head of queue
      setRecoveryQueue((prev) => prev.slice(1))
    } else {
      // increment errors and either re-queue or give up
      setErrorsByWord((prev) => ({ ...prev, [wid]: (prev[wid] ?? 0) + 1 }))
      if (nextAttempts >= RECOVERY_MAX_ATTEMPTS) {
        setRecoveryQueue((prev) => prev.slice(1))
      } else {
        setRecoveryQueue((prev) => {
          if (prev.length <= 1) return prev // only one left → re-show it
          return [...prev.slice(1), prev[0]]
        })
      }
    }
  }

  const finishBatch = async () => {
    setIsSubmitting(true)
    setError(null)
    const summaries: BatchSummary[] = []
    try {
      for (const w of currentBatch) {
        const errs = errorsByWord[w.id] ?? 0
        const hinted = usedHintByWord[w.id] ?? false
        let rating = computeRating(errs)
        if (rating === 'easy' && hinted) rating = 'hard'
        try {
          await submitReviewResult({ wordId: w.id, rating })
        } catch {
          // continue with other words even if one fails
        }
        summaries.push({ word: w.word, errors: errs, rating })
      }
      setSessionSummary((prev) => [...prev, ...summaries])
      // clear error map for this batch's words (not strictly needed)
      if (batchIdx >= batches.length - 1) {
        setPhase('session-done')
      } else {
        setBatchIdx(batchIdx + 1)
        setItemIdx(0)
        setPhase('study')
        setRecoveryQueue([])
        setRecoveryAttempts({})
        setUsedHintByWord({})
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  // ----- recovery queue completion watcher -----
  useEffect(() => {
    if (phase !== 'recovery') return
    if (recoveryQueue.length === 0) {
      void finishBatch()
    }
  }, [phase, recoveryQueue.length])

  // ----- typed-answer submit -----
  const submitTyped = () => {
    if (!currentWord) return
    if (status !== 'idle' || !typedAnswer.trim()) return
    const ok = isAnswerCorrect(typedAnswer, currentWord)
    setStatus(ok ? 'correct' : 'wrong')
    if (!ok) {
      setErrorsByWord((prev) => ({
        ...prev,
        [currentWord.id]: (prev[currentWord.id] ?? 0) + 1,
      }))
    }
  }

  const playHint = () => {
    if (!currentWord || status !== 'idle') return
    stopSpeaking()
    speak(currentWord.word, currentWord.language)
    setUsedHintByWord((prev) => ({ ...prev, [currentWord.id]: true }))
  }

  const markForgot = () => {
    if (!currentWord || status !== 'idle') return
    setStatus('wrong')
    setErrorsByWord((prev) => ({
      ...prev,
      [currentWord.id]: (prev[currentWord.id] ?? 0) + 1,
    }))
  }

  const advancePrimary = () => {
    if (!currentWord) return
    if (phase === 'study') {
      advanceStudy()
      return
    }
    if (status === 'idle') {
      submitTyped()
      return
    }
    // status is correct or wrong → advance
    if (phase === 'recovery') {
      advanceRecovery(status === 'correct')
    } else {
      advanceAfterTest()
    }
  }

  // Keyboard shortcuts: Enter advances the current step
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target
      if (target instanceof HTMLInputElement && !target.disabled) {
        // input handles its own Enter via onKeyDown
        return
      }
      if (event.key === 'Enter' && !isSubmitting && currentWord) {
        event.preventDefault()
        advancePrimary()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [phase, status, currentWord, typedAnswer, isSubmitting])

  // ===== Rendering =====

  if (isLoading) {
    return (
      <section className="page">
        <div className="card learn-card state-card">
          <h2>{t('learn.preparing')}</h2>
          <p className="muted">{t('learn.preparingHint')}</p>
        </div>
      </section>
    )
  }

  if (error) {
    return (
      <section className="page">
        <div className="card learn-card state-card">
          <h2>{error}</h2>
          <p className="muted">{t('learn.retryLater')}</p>
        </div>
      </section>
    )
  }

  if (allWords.length === 0) {
    return (
      <section className="page">
        <div className="card learn-card state-card">
          <h2>{t('learn.empty')}</h2>
          <p className="muted">
            {dueCount > 0
              ? t('learn.emptyHintWithDue', { count: dueCount })
              : t('learn.emptyHintNoDue')}
          </p>
          <div className="actions">
            {dueCount > 0 ? (
              <button
                type="button"
                className="primary-button"
                onClick={() => navigate('/review')}
              >
                {t('learn.goReview', { count: dueCount })}
              </button>
            ) : null}
            <Link
              className={dueCount > 0 ? 'secondary-link' : 'primary-link'}
              to="/words/new"
            >
              {t('learn.addWord')}
            </Link>
          </div>
        </div>
      </section>
    )
  }

  if (phase === 'session-done') {
    const total = sessionSummary.length
    const perfect = sessionSummary.filter((s) => s.errors === 0).length
    const slipped = total - perfect
    return (
      <section className="page">
        <div className="card learn-card state-card">
          <h2>{t('learn.sessionDoneTitle')}</h2>
          <p className="muted">
            {t('learn.sessionDoneSummary', { total, perfect, slipped })}
          </p>
          <ul className="learn-summary-list">
            {sessionSummary.map((item, idx) => (
              <li key={`${item.word}-${idx}`} className="learn-summary-item">
                <strong>{item.word}</strong>
                <span className={`learn-summary-rating learn-summary-${item.rating}`}>
                  {item.rating === 'easy'
                    ? '✓ Easy'
                    : item.rating === 'hard'
                      ? '· Hard'
                      : '✗ Again'}
                </span>
                {item.errors > 0 ? (
                  <span className="muted">{t('learn.errorCount', { count: item.errors })}</span>
                ) : null}
              </li>
            ))}
          </ul>
          <div className="actions">
            {dueCount > 0 ? (
              <button
                type="button"
                className="primary-button"
                onClick={() => navigate('/review')}
              >
                {t('learn.goReview', { count: dueCount })}
              </button>
            ) : null}
            <Link
              className={dueCount > 0 ? 'secondary-link' : 'primary-link'}
              to="/"
            >
              {t('learn.backHome')}
            </Link>
          </div>
        </div>
      </section>
    )
  }

  if (!currentWord) return null

  const examplePair = pickExamplePair(currentWord.example)
  const clozeSentence =
    examplePair && phase === 'cloze'
      ? buildCloze(examplePair.target, currentWord.word) ?? '___'
      : ''

  const phaseLabel: Record<Phase, string> = {
    study: t('learn.phaseStudy'),
    cloze: t('learn.phaseCloze'),
    recall: t('learn.phaseRecall'),
    recovery: t('learn.phaseRecovery'),
    'session-done': t('learn.phaseDone'),
  }

  const stageItemCount =
    phase === 'recovery' ? recoveryQueue.length : currentBatch.length
  const stageItemPosition =
    phase === 'recovery'
      ? 1
      : itemIdx + 1
  const recoveryAttempt =
    phase === 'recovery' && currentWord
      ? (recoveryAttempts[currentWord.id] ?? 0) + 1
      : 0

  return (
    <section className="page">
      <div className="card learn-card">
        <div className="learn-top">
          <div>
            <p className="eyebrow">{phaseLabel[phase]}</p>
            <h2>{t('learn.cardTitle', { folder: folderName })}</h2>
            <p className="muted">
              {t('learn.batchInfo', { current: batchIdx + 1, total: totalBatches })}
              {phase !== 'recovery'
                ? ` ${t('learn.itemInfo', { pos: stageItemPosition, count: stageItemCount })}`
                : ` ${t('learn.recoveryQueue', { count: stageItemCount })}`}
              {phase === 'recovery'
                ? ` ${t('learn.recoveryAttempt', { attempt: recoveryAttempt, max: RECOVERY_MAX_ATTEMPTS })}`
                : ''}
            </p>
          </div>
          <span className="learn-limit-pill">
            {t('learn.sessionTotal', { count: allWords.length })}
          </span>
        </div>
        <div className="progress-track">
          <span className="progress-bar" style={{ width: `${overallProgress}%` }} />
        </div>

        {phase === 'study' ? (
          <div className="learn-study-block">
            <div className="word-card-title learn-word-row">
              <strong className="word-title">{currentWord.word}</strong>
              <SpeakButton
                text={currentWord.word}
                reading={currentWord.reading}
                lang={currentWord.language}
                size="md"
              />
              <span className="muted word-reading">{currentWord.reading}</span>
            </div>
            {currentWord.partOfSpeech ? (
              <p className="muted">{t('learn.partOfSpeech', { value: currentWord.partOfSpeech })}</p>
            ) : null}
            {currentWord.meaning ? (
              <div className="learn-section">
                <p className="learn-label">{t('learn.meaningLabel')}</p>
                <p className="learn-text">{currentWord.meaning}</p>
              </div>
            ) : null}
            {currentWord.example ? (
              <div className="learn-section">
                <p className="learn-label">{t('learn.exampleLabel')}</p>
                <p className="word-example-text">{currentWord.example}</p>
              </div>
            ) : null}
            {currentWord.note ? (
              <div className="learn-section">
                <p className="learn-label">{t('learn.noteLabel')}</p>
                <p className="muted learn-note">{currentWord.note}</p>
              </div>
            ) : null}
            <div className="actions">
              <button type="button" className="primary-button" onClick={advanceStudy}>
                {t('learn.gotIt')}
              </button>
            </div>
          </div>
        ) : null}

        {phase === 'cloze' ? (
          <div className="recall-block">
            <p className="recall-prompt-label">{t('learn.clozeLabel')}</p>
            {clozeSentence ? (
              <p className="recall-prompt-text">{clozeSentence}</p>
            ) : (
              <>
                <p className="recall-prompt-text muted">{t('learn.noClozeFallback')}</p>
                <p className="recall-prompt-text">{currentWord.meaning}</p>
              </>
            )}
            {examplePair?.translation ? (
              <p className="muted recall-pos">
                {t('learn.clozeChineseLabel', { value: examplePair.translation })}
              </p>
            ) : null}

            <div className="recall-input-row">
              <input
                ref={recallInputRef}
                type="text"
                className="recall-input"
                value={typedAnswer}
                onChange={(event) => setTypedAnswer(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    // Always stop propagation so window-level Enter doesn't
                    // also advance in the same keystroke.
                    event.preventDefault()
                    event.stopPropagation()
                    if (status === 'idle') submitTyped()
                  }
                }}
                placeholder={
                  currentWord.language === 'jp'
                    ? t('learn.inputPlaceholderJp')
                    : t('learn.inputPlaceholderEn')
                }
                disabled={status !== 'idle'}
              />
              {status === 'idle' ? (
                <>
                  <button
                    type="button"
                    className="secondary-button hint-button"
                    onClick={playHint}
                    title={t('learn.hint')}
                  >
                    <SoundOutlined /> {t('learn.hint')}
                  </button>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={markForgot}
                    title={t('learn.forgot')}
                  >
                    {t('learn.forgot')}
                  </button>
                  <button
                    type="button"
                    className="primary-button"
                    disabled={!typedAnswer.trim()}
                    onClick={submitTyped}
                  >
                    {t('learn.submit')}
                  </button>
                </>
              ) : null}
            </div>

            {status !== 'idle' ? (
              <FeedbackBlock
                status={status}
                typed={typedAnswer}
                word={currentWord}
                onAdvance={advanceAfterTest}
              />
            ) : null}
          </div>
        ) : null}

        {phase === 'recall' ? (
          <div className="recall-block">
            <p className="recall-prompt-label">{t('learn.recallLabel')}</p>
            <p className="recall-prompt-text">
              {currentWord.meaning || currentWord.note || t('review.meaningEmpty')}
            </p>
            {currentWord.partOfSpeech ? (
              <p className="muted recall-pos">{t('learn.partOfSpeech', { value: currentWord.partOfSpeech })}</p>
            ) : null}

            <div className="recall-input-row">
              <input
                ref={recallInputRef}
                type="text"
                className="recall-input"
                value={typedAnswer}
                onChange={(event) => setTypedAnswer(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    // Always stop propagation so window-level Enter doesn't
                    // also advance in the same keystroke.
                    event.preventDefault()
                    event.stopPropagation()
                    if (status === 'idle') submitTyped()
                  }
                }}
                placeholder={
                  currentWord.language === 'jp'
                    ? t('learn.inputPlaceholderJp')
                    : t('learn.inputPlaceholderEn')
                }
                disabled={status !== 'idle'}
              />
              {status === 'idle' ? (
                <>
                  <button
                    type="button"
                    className="secondary-button hint-button"
                    onClick={playHint}
                    title={t('learn.hint')}
                  >
                    <SoundOutlined /> {t('learn.hint')}
                  </button>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={markForgot}
                    title={t('learn.forgot')}
                  >
                    {t('learn.forgot')}
                  </button>
                  <button
                    type="button"
                    className="primary-button"
                    disabled={!typedAnswer.trim()}
                    onClick={submitTyped}
                  >
                    {t('learn.submit')}
                  </button>
                </>
              ) : null}
            </div>

            {status !== 'idle' ? (
              <FeedbackBlock
                status={status}
                typed={typedAnswer}
                word={currentWord}
                onAdvance={advanceAfterTest}
              />
            ) : null}
          </div>
        ) : null}

        {phase === 'recovery' ? (
          <div className="recall-block">
            <p className="recall-prompt-label">{t('learn.recoveryLabel')}</p>
            <p className="recall-prompt-text">
              {currentWord.meaning || currentWord.note || '（无释义）'}
            </p>
            {currentWord.partOfSpeech ? (
              <p className="muted recall-pos">词性：{currentWord.partOfSpeech}</p>
            ) : null}

            <div className="recall-input-row">
              <input
                ref={recallInputRef}
                type="text"
                className="recall-input"
                value={typedAnswer}
                onChange={(event) => setTypedAnswer(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    // Always stop propagation so window-level Enter doesn't
                    // also advance in the same keystroke.
                    event.preventDefault()
                    event.stopPropagation()
                    if (status === 'idle') submitTyped()
                  }
                }}
                placeholder={
                  currentWord.language === 'jp'
                    ? t('learn.inputPlaceholderJp')
                    : t('learn.inputPlaceholderEn')
                }
                disabled={status !== 'idle'}
              />
              {status === 'idle' ? (
                <>
                  <button
                    type="button"
                    className="secondary-button hint-button"
                    onClick={playHint}
                    title={t('learn.hint')}
                  >
                    <SoundOutlined /> {t('learn.hint')}
                  </button>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={markForgot}
                    title={t('learn.forgot')}
                  >
                    {t('learn.forgot')}
                  </button>
                  <button
                    type="button"
                    className="primary-button"
                    disabled={!typedAnswer.trim()}
                    onClick={submitTyped}
                  >
                    {t('learn.submit')}
                  </button>
                </>
              ) : null}
            </div>

            {status !== 'idle' ? (
              <FeedbackBlock
                status={status}
                typed={typedAnswer}
                word={currentWord}
                onAdvance={() => advanceRecovery(status === 'correct')}
                continueLabel={
                  status === 'correct'
                    ? t('learn.continue')
                    : recoveryAttempt < RECOVERY_MAX_ATTEMPTS
                      ? t('learn.retry')
                      : t('learn.skip')
                }
              />
            ) : null}
          </div>
        ) : null}

        {isSubmitting ? (
          <p className="muted" style={{ textAlign: 'center', marginTop: 12 }}>
            {t('learn.submittingBatch')}
          </p>
        ) : null}
      </div>
    </section>
  )
}

function FeedbackBlock({
  status,
  typed,
  word,
  onAdvance,
  continueLabel,
}: {
  status: Status
  typed: string
  word: Word
  onAdvance: () => void
  continueLabel?: string
}) {
  const { t } = useI18n()
  const label = continueLabel ?? t('learn.continue')
  return status === 'correct' ? (
    <div className="recall-feedback recall-feedback-correct">
      <p>
        <strong>{t('learn.correct')}</strong>
      </p>
      <div className="recall-reveal">
        <strong>{word.word}</strong>
        {word.reading ? (
          <span className="muted">{word.reading}</span>
        ) : null}
        <SpeakButton
          text={word.word}
          reading={word.reading}
          lang={word.language}
          size="md"
          label={t('learn.readWord')}
        />
      </div>
      {word.example ? (
        <p className="muted multiline-text">{word.example}</p>
      ) : null}
      <div className="actions">
        <button type="button" className="primary-button" onClick={onAdvance}>
          {label}（Enter）
        </button>
      </div>
    </div>
  ) : (
    <div className="recall-feedback recall-feedback-wrong">
      <p>
        <strong>{t('learn.wrong')}</strong>
        <span className="muted">  {t('learn.yourInput', { value: typed })}</span>
      </p>
      <div className="recall-reveal">
        <span className="muted">{t('learn.correctAnswer')}</span>
        <strong>{word.word}</strong>
        {word.reading ? (
          <span className="muted">{word.reading}</span>
        ) : null}
        <SpeakButton
          text={word.word}
          reading={word.reading}
          lang={word.language}
          size="md"
          label={t('learn.readWord')}
        />
      </div>
      {word.example ? (
        <p className="muted multiline-text">{word.example}</p>
      ) : null}
      <div className="actions">
        <button type="button" className="danger-button" onClick={onAdvance}>
          {label}（Enter）
        </button>
      </div>
    </div>
  )
}
