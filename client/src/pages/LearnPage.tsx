import { useEffect, useMemo, useRef, useState } from 'react'
import { Volume2 } from 'lucide-react'
import { Link, useNavigate } from 'react-router'
import { correctReviewResult, submitReviewResult } from '../api/review'
import type { ReviewSnapshot } from '../api/review'
import { getTodayNewWords } from '../api/words'
import { SpeakButton } from '../components/SpeakButton'
import { useI18n } from '../i18n'
import { useAppStore } from '../store/useAppStore'
import type { ReviewRating, Word } from '../types'
import { pickSpeakableText, speak, stopSpeaking } from '../utils/speech'
import { Button } from '@heroui/react'

const BATCH_SIZE = 5
const RECOVERY_MAX_ATTEMPTS = 3

type Phase = 'study' | 'cloze' | 'recall' | 'recovery' | 'session-done'
type Status = 'idle' | 'correct' | 'wrong'

type BatchSummary = {
  wordId: string
  word: string
  meaning: string
  errors: number
  rating: ReviewRating
  // FSRS state right BEFORE this rating was submitted. Used by the misclick
  // rescue panel at session-done to let the user re-rate without piling a
  // second mutation on top of the (possibly wrong) first one.
  snapshot: ReviewSnapshot
}

function katakanaToHiragana(value: string) {
  return value.replace(/[ァ-ヶ]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0x60),
  )
}

function normalizeAnswer(value: string) {
  return katakanaToHiragana(value.trim().toLowerCase()).replace(/\s+/g, ' ')
}

const EXAMPLE_TEXT =
  'm-0 text-sm/[1.65] whitespace-pre-wrap break-words text-foreground [overflow-wrap:anywhere]'
const LEN_ROW = 'inline-flex items-center gap-2 text-[13px]'
const LEARN_SECTION =
  'mt-3.5 rounded-xl border border-border bg-foreground/2 px-3.5 py-3 break-words [overflow-wrap:anywhere]'
const LEARN_LABEL =
  'mt-0 mb-2 text-xs font-bold tracking-[0.06em] uppercase text-muted'
const LEARN_BODY = 'm-0 leading-[1.7] whitespace-pre-wrap [overflow-wrap:anywhere]'
// 评分标签的配色，键就是 FSRS 的 rating。
const SUMMARY_TONE = {
  easy: 'bg-green-600/12 text-green-700',
  hard: 'bg-orange-600/12 text-orange-700',
  again: 'bg-red-500/12 text-red-700',
} as const
const SLOT =
  'inline-block min-w-4 text-center font-mono tracking-[1px] text-foreground/40'

/** Visual cue for the word's character / kana count. When the meaning prompt
 *  is too vague to uniquely identify the word, this length hint constrains
 *  the answer shape without giving the letters away. */
function RecallLengthHint({ word }: { word: Word }) {
  const wordChars = Array.from(word.word ?? '')
  const readingChars = Array.from(word.reading ?? '')
  if (wordChars.length === 0) return null
  const isJp = word.language === 'jp'
  // Render N underscore slots so the user sees the visual length too.
  const slots = (n: number) =>
    Array.from({ length: n }).map((_, i) => (
      <span key={i} className={SLOT}>_</span>
    ))
  const same = word.word === word.reading || readingChars.length === 0
  return (
    <div className="muted my-2 mb-3 flex flex-col gap-1.5">
      <div className={LEN_ROW}>
        {slots(wordChars.length)}
        <span className="text-xs text-muted">
          {wordChars.length}
          {isJp ? ' 字' : ' letters'}
        </span>
      </div>
      {isJp && !same ? (
        <div className={`${LEN_ROW} opacity-75`}>
          {slots(readingChars.length)}
          <span className="text-xs text-muted">{readingChars.length} 假名</span>
        </div>
      ) : null}
    </div>
  )
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
    // Literal match first.
    let idx = sentence.indexOf(trimmed)
    if (idx !== -1) {
      return sentence.slice(0, idx) + blank + sentence.slice(idx + trimmed.length)
    }
    // Conjugation fallback: the dictionary form (e.g. 握る) may appear in the
    // example as a conjugated form (握った / 握れる / 握らない). Match by the
    // leading kanji run, then expand forward through the kana tail so the
    // whole inflected word gets blanked, not just the kanji.
    const stemMatch = trimmed.match(/^[一-龯]+/)
    if (stemMatch) {
      const stem = stemMatch[0]
      idx = sentence.indexOf(stem)
      if (idx !== -1) {
        let end = idx + stem.length
        // Eat hiragana/katakana/long-mark tail.
        while (end < sentence.length && /[ぁ-ゟ゠-ヿー]/.test(sentence[end])) {
          end++
        }
        return sentence.slice(0, idx) + blank + sentence.slice(end)
      }
    }
    // Reading fallback: for hiragana-only words (e.g. するする) where the
    // example may include the same kana directly. We don't have the reading
    // here without plumbing — caller will pass null through to the empty
    // path and the JSX renders the full sentence as fallback.
    return null
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
  // wordId → "what the user changed Again to" at session-done. Local-only;
  // posted to the server when the user clicks 应用修正.
  const [correctionDraft, setCorrectionDraft] = useState<Record<string, 'hard' | 'easy'>>({})
  const [isApplyingCorrection, setIsApplyingCorrection] = useState(false)
  const [correctionApplied, setCorrectionApplied] = useState(false)
  const recallInputRef = useRef<HTMLInputElement | null>(null)

  // Append a "final review" batch containing every word in the session, so
  // after the per-5 batches the user gets one unified cloze+recall pass over
  // everything they just learned. Only when there is more than one regular
  // batch — otherwise the only batch IS already the whole set.
  const batches = useMemo(() => {
    const chunks = chunkInto(allWords, BATCH_SIZE)
    if (allWords.length > BATCH_SIZE) chunks.push(allWords)
    return chunks
  }, [allWords])
  const hasFinalRound = allWords.length > BATCH_SIZE
  const isFinalRound = hasFinalRound && batchIdx === batches.length - 1
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
        setCorrectionDraft({})
        setCorrectionApplied(false)
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
      speak(
        pickSpeakableText(currentWord.word, currentWord.reading, currentWord.language),
        currentWord.language,
      )
    }
  }, [phase, currentWord?.id])

  useEffect(() => {
    if (!currentWord) return
    if (status === 'correct' || status === 'wrong') {
      speak(
        pickSpeakableText(currentWord.word, currentWord.reading, currentWord.language),
        currentWord.language,
      )
    }
    // currentWord.id is intentionally excluded — when advancing to the next
    // recall item, status is still 'correct'/'wrong' from the previous answer
    // and a re-run here would speak the NEW word right when the user is
    // about to type it, giving away the answer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

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
    try {
      // Final review round is a self-check only — every word already had its
      // FSRS review submitted in its original 5-word batch. Submitting again
      // here would overwrite that rating with one based on a much harder
      // delayed-recall result, which is not what we want.
      if (!isFinalRound) {
        const summaries: BatchSummary[] = []
        for (const w of currentBatch) {
          const errs = errorsByWord[w.id] ?? 0
          const hinted = usedHintByWord[w.id] ?? false
          let rating = computeRating(errs)
          if (rating === 'easy' && hinted) rating = 'hard'
          // Snapshot the pre-rating FSRS state. Each word in a Learn session
          // submits exactly once (final round doesn't submit), so word.review
          // is still the pre-submission state here.
          const snapshot: ReviewSnapshot = {
            interval: w.review?.interval ?? 1,
            repetition: w.review?.repetition ?? 0,
            easeFactor: w.review?.easeFactor ?? 2.5,
            difficultyScore: w.review?.difficultyScore ?? 0,
            recentRatings: w.review?.recentRatings ?? '',
            firstLearnedAt: w.review?.firstLearnedAt ?? null,
            lastReviewedAt: w.review?.lastReviewedAt ?? null,
          }
          try {
            await submitReviewResult({ wordId: w.id, rating })
          } catch {
            // continue with other words even if one fails
          }
          summaries.push({
            wordId: w.id,
            word: w.word,
            meaning: w.meaning,
            errors: errs,
            rating,
            snapshot,
          })
        }
        setSessionSummary((prev) => [...prev, ...summaries])
      }
      if (batchIdx >= batches.length - 1) {
        setPhase('session-done')
      } else {
        const nextIdx = batchIdx + 1
        const nextIsFinal = hasFinalRound && nextIdx === batches.length - 1
        setBatchIdx(nextIdx)
        setItemIdx(0)
        // Final round skips Study (the user already saw every word) and goes
        // straight to cloze. Reset error/recovery state so the round starts
        // fresh — pre-existing errorsByWord from per-batch tests would
        // pre-poison the recovery queue.
        setPhase(nextIsFinal ? 'cloze' : 'study')
        setRecoveryQueue([])
        setRecoveryAttempts({})
        setUsedHintByWord({})
        if (nextIsFinal) {
          setErrorsByWord({})
          setTypedAnswer('')
          setStatus('idle')
        }
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
    speak(
      pickSpeakableText(currentWord.word, currentWord.reading, currentWord.language),
      currentWord.language,
    )
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
        <div className="card state-card mx-auto w-full max-w-[660px] p-7 text-left max-md:px-4.5 max-md:py-5.5">
          <h2>{t('learn.preparing')}</h2>
          <p className="muted">{t('learn.preparingHint')}</p>
        </div>
      </section>
    )
  }

  if (error) {
    return (
      <section className="page">
        <div className="card state-card mx-auto w-full max-w-[660px] p-7 text-left max-md:px-4.5 max-md:py-5.5">
          <h2>{error}</h2>
          <p className="muted">{t('learn.retryLater')}</p>
        </div>
      </section>
    )
  }

  if (allWords.length === 0) {
    return (
      <section className="page">
        <div className="card state-card mx-auto w-full max-w-[660px] p-7 text-left max-md:px-4.5 max-md:py-5.5">
          <h2>{t('learn.empty')}</h2>
          <p className="muted">
            {dueCount > 0
              ? t('learn.emptyHintWithDue', { count: dueCount })
              : t('learn.emptyHintNoDue')}
          </p>
          <div className="actions">
            {dueCount > 0 ? (
              <Button
                type="button"
                onPress={() => navigate('/review')}
              >
                {t('learn.goReview', { count: dueCount })}
              </Button>
            ) : null}
            <Link
              className={`button `}
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
    const againItems = sessionSummary.filter((s) => s.rating === 'again')
    const pendingFixes = Object.entries(correctionDraft)
    const applyCorrections = async () => {
      if (pendingFixes.length === 0) return
      setIsApplyingCorrection(true)
      try {
        for (const [wordId, newRating] of pendingFixes) {
          const item = sessionSummary.find((s) => s.wordId === wordId)
          if (!item) continue
          try {
            await correctReviewResult({
              wordId,
              snapshot: item.snapshot,
              newRating,
            })
          } catch {
            // skip failed corrections; the rest still apply
          }
        }
        setSessionSummary((prev) =>
          prev.map((item) => {
            const fix = correctionDraft[item.wordId]
            return fix ? { ...item, rating: fix } : item
          }),
        )
        setCorrectionDraft({})
        setCorrectionApplied(true)
      } finally {
        setIsApplyingCorrection(false)
      }
    }
    return (
      <section className="page">
        <div className="card state-card mx-auto w-full max-w-[660px] p-7 text-left max-md:px-4.5 max-md:py-5.5">
          <h2>{t('learn.sessionDoneTitle')}</h2>
          <p className="muted">
            {t('learn.sessionDoneSummary', { total, perfect, slipped })}
          </p>

          {againItems.length > 0 ? (
            <div className="mx-auto mt-4 max-w-[520px] rounded-xl border border-danger/18 bg-danger/6 px-4 py-3.5 text-left">
              <div className="mb-2.5 flex flex-col gap-0.5 [&>strong]:text-sm [&>strong]:text-red-700 [&>.muted]:text-xs">
                <strong>{t('learn.againRescueTitle', { count: againItems.length })}</strong>
                <span className="muted">{t('learn.againRescueHint')}</span>
              </div>
              <ul className="m-0 grid list-none gap-2 p-0">
                {againItems.map((item) => {
                  const draft = correctionDraft[item.wordId]
                  return (
                    <li key={item.wordId} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-white/60 px-2.5 py-2">
                      <div className="flex min-w-0 flex-[1_1_160px] items-baseline gap-1.5 [&>strong]:text-[15px] [&>strong]:text-foreground">
                        <strong>{item.word}</strong>
                        {item.meaning ? (
                          <span className="muted">· {item.meaning}</span>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        <Button
                          type="button"
                          size="sm"
                          variant={!draft ? 'primary' : 'outline'}
                          className="text-xs"
                          onPress={() =>
                            setCorrectionDraft((prev) => {
                              const next = { ...prev }
                              delete next[item.wordId]
                              return next
                            })
                          }
                          isDisabled={isApplyingCorrection}
                        >
                          {t('learn.againRescueKeep')}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant={draft === 'hard' ? 'primary' : 'outline'}
                          className="text-xs"
                          onPress={() =>
                            setCorrectionDraft((prev) => ({
                              ...prev,
                              [item.wordId]: 'hard',
                            }))
                          }
                          isDisabled={isApplyingCorrection}
                        >
                          {t('learn.againRescueToHard')}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant={draft === 'easy' ? 'primary' : 'outline'}
                          className="text-xs"
                          onPress={() =>
                            setCorrectionDraft((prev) => ({
                              ...prev,
                              [item.wordId]: 'easy',
                            }))
                          }
                          isDisabled={isApplyingCorrection}
                        >
                          {t('learn.againRescueToEasy')}
                        </Button>
                      </div>
                    </li>
                  )
                })}
              </ul>
              <div className="mt-3 flex items-center gap-3">
                <Button
                  type="button"
                  onPress={() => void applyCorrections()}
                  isDisabled={pendingFixes.length === 0 || isApplyingCorrection}
                >
                  {isApplyingCorrection
                    ? t('learn.againRescueApplying')
                    : t('learn.againRescueApply', { count: pendingFixes.length })}
                </Button>
                {correctionApplied ? (
                  <span className="muted">{t('learn.againRescueApplied')}</span>
                ) : null}
              </div>
            </div>
          ) : null}

          <ul className="mx-auto mt-4 grid max-w-[420px] list-none gap-1.5 p-0">
            {sessionSummary.map((item, idx) => (
              <li key={`${item.word}-${idx}`} className="flex items-center gap-2.5 rounded-lg bg-foreground/3 px-2.5 py-1.5 text-sm [&>strong]:flex-1 [&>strong]:text-left [&>strong]:text-foreground">
                <strong>{item.word}</strong>
                <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${SUMMARY_TONE[item.rating]}`}>
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
              <Button
                type="button"
                onPress={() => navigate('/review')}
              >
                {t('learn.goReview', { count: dueCount })}
              </Button>
            ) : null}
            <Link
              className={`button `}
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
  // null = couldn't blank out the target word in the example. Keep null and
  // let the JSX render the original sentence (no blank) as a context-only
  // fallback — better than a lone "___" with no surrounding Japanese.
  const clozeSentence =
    examplePair && phase === 'cloze'
      ? buildCloze(examplePair.target, currentWord.word)
      : null

  const phaseLabel: Record<Phase, string> = {
    study: t('learn.phaseStudy'),
    cloze: t('learn.phaseCloze'),
    recall: t('learn.phaseRecall'),
    recovery: t('learn.phaseRecovery'),
    'session-done': t('learn.phaseDone'),
  }
  const phaseDisplay = isFinalRound
    ? `${t('learn.finalRoundPrefix')} · ${phaseLabel[phase]}`
    : phaseLabel[phase]

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
      <div className="card mx-auto w-full max-w-[660px] p-7 text-left max-md:px-4.5 max-md:py-5.5">
        <div className="mb-1.5 flex items-start justify-between gap-3 max-md:flex-col max-md:items-start">
          <div>
            <p className="eyebrow">{phaseDisplay}</p>
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
          <span className="inline-flex items-center rounded-full border border-accent/22 bg-accent/10 px-3 py-1.5 text-[13px] font-bold whitespace-nowrap text-accent">
            {t('learn.sessionTotal', { count: allWords.length })}
          </span>
        </div>
        <div className="progress-track">
          <span className="progress-bar" style={{ width: `${overallProgress}%` }} />
        </div>

        {phase === 'study' ? (
          <div className="grid gap-2.5">
            <div className="word-card-title mt-2.5 mb-1">
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
              <div className={LEARN_SECTION}>
                <p className={LEARN_LABEL}>{t('learn.meaningLabel')}</p>
                <p className={LEARN_BODY}>{currentWord.meaning}</p>
              </div>
            ) : null}
            {currentWord.example ? (
              <div className={LEARN_SECTION}>
                <p className={LEARN_LABEL}>{t('learn.exampleLabel')}</p>
                <p className={EXAMPLE_TEXT}>{currentWord.example}</p>
              </div>
            ) : null}
            {currentWord.note ? (
              <div className={LEARN_SECTION}>
                <p className={LEARN_LABEL}>{t('learn.noteLabel')}</p>
                <p className={`muted ${LEARN_BODY}`}>{currentWord.note}</p>
              </div>
            ) : null}
            <div className="actions">
              <Button type="button" onPress={advanceStudy}>
                {t('learn.gotIt')}
              </Button>
            </div>
          </div>
        ) : null}

        {phase === 'cloze' ? (
          <div className="recall-block">
            <p className="recall-prompt-label">{t('learn.clozeLabel')}</p>
            {clozeSentence ? (
              <p className="recall-prompt-text">{clozeSentence}</p>
            ) : (
              // Cloze couldn't be built (no example, or the target word isn't
              // literally in it). Show the full Japanese example (no blank)
              // so the user at least has context, plus the Chinese meaning
              // to identify which word inside the sentence to type.
              <>
                {examplePair?.target ? (
                  <p className="recall-prompt-text">{examplePair.target}</p>
                ) : null}
                <p className="muted">{t('learn.noClozeFallback')}</p>
                {currentWord.meaning ? (
                  <p className="recall-prompt-text">{currentWord.meaning}</p>
                ) : null}
              </>
            )}
            {examplePair?.translation ? (
              <p className="muted recall-pos">
                {t('learn.clozeChineseLabel', { value: examplePair.translation })}
              </p>
            ) : null}
            <RecallLengthHint word={currentWord} />

            <div className="recall-input-row">
              <input
                ref={recallInputRef}
                type="text"
                className="recall-input"
                value={typedAnswer}
                onChange={(event) => setTypedAnswer(event.target.value)}
                onKeyDown={(event) => {
                  // Skip Enter while IME composition is still open (Japanese
                  // IME confirming a kanji candidate presses Enter too) —
                  // those aren't the user submitting their answer.
                  // keyCode === 229 is the legacy IME signal.
                  if (
                    event.key === 'Enter' &&
                    !event.nativeEvent.isComposing &&
                    event.keyCode !== 229
                  ) {
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
                  <Button variant="outline"
                    type="button"
                    onPress={playHint}
                    render={(props) => <button {...props} title={t('learn.hint')} />}
                  >
                    <Volume2 /> {t('learn.hint')}
                  </Button>
                  <Button variant="outline" size="sm"
                    type="button"
                    onPress={markForgot}
                    render={(props) => <button {...props} title={t('learn.forgot')} />}
                  >
                    {t('learn.forgot')}
                  </Button>
                  <Button
                    type="button"
                    isDisabled={!typedAnswer.trim()}
                    onPress={submitTyped}
                  >
                    {t('learn.submit')}
                  </Button>
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

            <RecallLengthHint word={currentWord} />

            <div className="recall-input-row">
              <input
                ref={recallInputRef}
                type="text"
                className="recall-input"
                value={typedAnswer}
                onChange={(event) => setTypedAnswer(event.target.value)}
                onKeyDown={(event) => {
                  // Skip Enter while IME composition is still open (Japanese
                  // IME confirming a kanji candidate presses Enter too) —
                  // those aren't the user submitting their answer.
                  // keyCode === 229 is the legacy IME signal.
                  if (
                    event.key === 'Enter' &&
                    !event.nativeEvent.isComposing &&
                    event.keyCode !== 229
                  ) {
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
                  <Button variant="outline"
                    type="button"
                    onPress={playHint}
                    render={(props) => <button {...props} title={t('learn.hint')} />}
                  >
                    <Volume2 /> {t('learn.hint')}
                  </Button>
                  <Button variant="outline" size="sm"
                    type="button"
                    onPress={markForgot}
                    render={(props) => <button {...props} title={t('learn.forgot')} />}
                  >
                    {t('learn.forgot')}
                  </Button>
                  <Button
                    type="button"
                    isDisabled={!typedAnswer.trim()}
                    onPress={submitTyped}
                  >
                    {t('learn.submit')}
                  </Button>
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
                  // Skip Enter while IME composition is still open (Japanese
                  // IME confirming a kanji candidate presses Enter too) —
                  // those aren't the user submitting their answer.
                  // keyCode === 229 is the legacy IME signal.
                  if (
                    event.key === 'Enter' &&
                    !event.nativeEvent.isComposing &&
                    event.keyCode !== 229
                  ) {
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
                  <Button variant="outline"
                    type="button"
                    onPress={playHint}
                    render={(props) => <button {...props} title={t('learn.hint')} />}
                  >
                    <Volume2 /> {t('learn.hint')}
                  </Button>
                  <Button variant="outline" size="sm"
                    type="button"
                    onPress={markForgot}
                    render={(props) => <button {...props} title={t('learn.forgot')} />}
                  >
                    {t('learn.forgot')}
                  </Button>
                  <Button
                    type="button"
                    isDisabled={!typedAnswer.trim()}
                    onPress={submitTyped}
                  >
                    {t('learn.submit')}
                  </Button>
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
        <Button type="button" onPress={onAdvance}>
          {label}（Enter）
        </Button>
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
      {word.meaning ? (
        <p className="multiline-text mt-2 mb-1 text-[15px] font-medium text-foreground">{word.meaning}</p>
      ) : null}
      {word.example ? (
        <p className="muted multiline-text">{word.example}</p>
      ) : null}
      <div className="actions">
        <Button variant="danger" type="button" onPress={onAdvance}>
          {label}（Enter）
        </Button>
      </div>
    </div>
  )
}
