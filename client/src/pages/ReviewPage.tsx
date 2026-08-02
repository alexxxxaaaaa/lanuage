import { useEffect, useMemo, useRef, useState } from 'react'
import { SelectField } from '../components/ui/SelectField'
import { Volume2 } from 'lucide-react'
import { Link } from 'react-router'
import { correctReviewResult } from '../api/review'
import type { ReviewSnapshot } from '../api/review'
import { SpeakButton } from '../components/SpeakButton'
import { VoicePicker } from '../components/VoicePicker'
import { useI18n } from '../i18n'
import { useAppStore } from '../store/useAppStore'
import { pickSpeakableText, speak, stopSpeaking } from '../utils/speech'
import { Button } from '@heroui/react'

// FSRS rating buttons. min-h-0 sheds the global 44px button floor so the
// written padding decides the height.
const RATING_BTN =
  'min-h-0 min-w-23 cursor-pointer rounded-xl border px-5.5 py-2.5 text-[15px] font-semibold tracking-[0.02em] transition-[background-color,border-color,transform,box-shadow] duration-150 disabled:cursor-not-allowed disabled:opacity-50 not-disabled:hover:-translate-y-px not-disabled:hover:shadow-[0_6px_14px_rgba(15,23,42,0.08)] not-disabled:active:translate-y-0'
const RATING_TONE = {
  again: 'border-red-600/20 bg-red-100 text-red-800 not-disabled:hover:bg-red-200',
  hard: 'border-yellow-500/30 bg-amber-100 text-amber-900 not-disabled:hover:bg-amber-200',
  easy: 'border-emerald-500/30 bg-emerald-100 text-emerald-800 not-disabled:hover:bg-emerald-200',
  skip: 'border-black/8 bg-gray-100 text-gray-600 not-disabled:hover:bg-gray-200',
} as const

// Step indicator above the card (看词 → 回想 → 评分).
const STEP_PILL =
  'inline-flex items-center rounded-full border px-2.5 py-1.5 text-xs font-bold'
const STEP_ACTIVE = 'border-accent bg-accent text-white'
const STEP_DONE = 'border-emerald-500/28 bg-emerald-500/14 text-emerald-800'

type AgainEntry = {
  wordId: string
  word: string
  meaning: string
  snapshot: ReviewSnapshot
}

type ReviewStepKey = 'recognition' | 'recall' | 'pronunciation'

export function ReviewPage() {
  const { t } = useI18n()
  const REVIEW_STEPS = useMemo(
    () =>
      [
        {
          key: 'pronunciation' as const,
          label: t('review.stepPronunciation'),
          hint: t('review.stepPronunciationHint'),
        },
        {
          key: 'recognition' as const,
          label: t('review.stepRecognition'),
          hint: t('review.stepRecognitionHint'),
        },
        {
          key: 'recall' as const,
          label: t('review.stepRecall'),
          hint: t('review.stepRecallHint'),
        },
      ],
    [t],
  )
  const folders = useAppStore((state) => state.folders)
  const isLoadingFolders = useAppStore((state) => state.isLoadingFolders)
  const todayReviews = useAppStore((state) => state.todayReviews)
  const totalReviewCount = useAppStore((state) => state.totalReviewCount)
  const reviewFolderId = useAppStore((state) => state.reviewFolderId)
  const currentIndex = useAppStore((state) => state.currentIndex)
  const isCardFlipped = useAppStore((state) => state.isCardFlipped)
  const isLoadingReviews = useAppStore((state) => state.isLoadingReviews)
  const isSubmitting = useAppStore((state) => state.isSubmitting)
  const error = useAppStore((state) => state.error)
  const [stepIndex, setStepIndex] = useState(0)
  // Per-word retry queue: the LIST of failed stage indices that still need
  // redoing. Failing at step 2 stores [2]; failing at step 0 and 2 stores
  // [0, 2]. Retry cycles ONLY through the failed stages — retrying stages
  // the user already passed would leak info (e.g. hearing the pronunciation
  // gives away the spelling for a recall-only failure).
  const [retryStagesByWord, setRetryStagesByWord] = useState<
    Record<string, number[]>
  >({})
  const [stepRatings, setStepRatings] = useState<
    Record<string, Partial<Record<ReviewStepKey, 'again' | 'hard' | 'easy'>>>
  >({})
  const [debtByWord, setDebtByWord] = useState<Record<string, number>>({})
  const [repeatCountByWord, setRepeatCountByWord] = useState<Record<string, number>>({})
  const [typedRecall, setTypedRecall] = useState('')
  const [recallStatus, setRecallStatus] = useState<'idle' | 'correct' | 'wrong'>('idle')
  const [recallUsedHint, setRecallUsedHint] = useState(false)
  const recallInputRef = useRef<HTMLInputElement | null>(null)

  // Words that ended up rated `again` this session, with their pre-rating
  // FSRS snapshots, so the rescue panel can re-submit a corrected rating.
  const [againEntries, setAgainEntries] = useState<AgainEntry[]>([])
  const [correctionDraft, setCorrectionDraft] = useState<Record<string, 'hard' | 'easy'>>({})
  const [isApplyingCorrection, setIsApplyingCorrection] = useState(false)
  const [correctionApplied, setCorrectionApplied] = useState(false)
  // Per-session rating tally shown on session-done. Counts each word ONCE
  // (final rating after FSRS commit), not per-cycle repeats.
  const [sessionStats, setSessionStats] = useState<{
    easy: number
    hard: number
    again: number
  }>({ easy: 0, hard: 0, again: 0 })
  // "Did this word ever get an `again` rating this session?" — used to
  // classify the session-done stats. If the user hit Again at ANY step
  // (even if they later cleaned it up on retry and the FSRS finalRating
  // ended up 'easy'), we still count it as an Again in the recap: the user
  // wants credit for "I needed help on this" rather than "I eventually
  // remembered". FSRS finalRating stays unchanged (scheduling is separate).
  const [hadAgainByWord, setHadAgainByWord] = useState<Record<string, boolean>>({})

  const folderList = Array.isArray(folders) ? folders : []

  useEffect(() => {
    useAppStore.getState().clearError()
    void useAppStore.getState().fetchFolders()
    void useAppStore.getState().fetchTodayReviews()
    useAppStore.getState().resetReviewSession()
  }, [])

  useEffect(() => {
    setStepIndex(0)
    setStepRatings({})
    setDebtByWord({})
    setRepeatCountByWord({})
    setAgainEntries([])
    setCorrectionDraft({})
    setCorrectionApplied(false)
    setSessionStats({ easy: 0, hard: 0, again: 0 })
    setHadAgainByWord({})
    setRetryStagesByWord({})
    useAppStore.getState().resetReviewSession()
  }, [reviewFolderId])

  const reviews = Array.isArray(todayReviews) ? todayReviews : []
  const currentReview = reviews[currentIndex]
  const currentWord = currentReview?.word
  const completedWords = Math.max(0, totalReviewCount - reviews.length)
  // Words in retry-mode use their private failed-stage queue; everyone
  // else uses the global stepIndex. `retryStages` is the head of the
  // failed-stage list to redo, so if a user only failed at recall, they
  // ONLY see recall on retry (not pronunciation/recognition again).
  const currentRetryStages =
    currentReview ? retryStagesByWord[currentReview.wordId] : undefined
  const retryStep =
    currentRetryStages && currentRetryStages.length > 0
      ? currentRetryStages[0]
      : null
  const effectiveStepIndex = retryStep ?? stepIndex
  const currentStep = REVIEW_STEPS[effectiveStepIndex]
  const isLastStep = effectiveStepIndex === REVIEW_STEPS.length - 1
  const isInRetry = retryStep !== null
  /** 当前是第几个单词（1…总词数），三种复习方式共用同一个「第几词」，不会变成 60/30 */
  const currentWordPosition =
    totalReviewCount === 0
      ? 0
      : Math.min(totalReviewCount, completedWords + currentIndex + 1)
  const totalCards = totalReviewCount * REVIEW_STEPS.length
  const completedCards =
    completedWords * REVIEW_STEPS.length + stepIndex * reviews.length + currentIndex
  const progressPercent = totalCards === 0 ? 0 : (completedCards / totalCards) * 100

  const getDebtDelta = (rating: 'again' | 'hard' | 'easy') => {
    if (rating === 'again') return 2
    if (rating === 'hard') return 1
    return -1
  }

  const toFinalRatingByDebt = (debt: number): 'again' | 'hard' | 'easy' => {
    if (debt >= 3) return 'again'
    if (debt >= 1) return 'hard'
    return 'easy'
  }

  const goNextInRound = () => {
    if (currentIndex < reviews.length - 1) {
      useAppStore.getState().goToNextReview()
      return
    }
    setStepIndex((prev) => Math.min(prev + 1, REVIEW_STEPS.length - 1))
    useAppStore.getState().setReviewIndex(0)
  }

  // Skip the ENTIRE current step (not just this word). Jumps stepIndex forward
  // for the whole queue — any words that didn't get a rating in the skipped
  // step fall back to 'easy' in the final FSRS fold (see handleStepRating's
  // accumulation logic). Only meaningful on steps 1 and 2; on the last step
  // we hide the button entirely because "skipping" recall would end the
  // session prematurely, which the existing rating buttons already handle.
  const handleSkipStep = () => {
    if (isLastStep) return
    setStepIndex(stepIndex + 1)
    useAppStore.getState().setReviewIndex(0)
    if (isCardFlipped) {
      useAppStore.getState().toggleCard()
    }
  }

  const handleStepRating = async (rating: 'again' | 'hard' | 'easy') => {
    if (!currentReview) return
    const wordId = currentReview.wordId
    const stepKey = currentStep.key

    // Track any-step Again for the session-done stats. Persists across
    // cycles — even if the user later retries and passes, we remember.
    if (rating === 'again') {
      setHadAgainByWord((prev) => ({ ...prev, [wordId]: true }))
    }

    // Always record the rating for the stage we're on. This works for both
    // normal mode (progressive cycle) and retry mode (revisits a specific
    // failed stage) — the stored rating for that stage gets overwritten.
    const nextStepRatings = {
      ...stepRatings,
      [wordId]: {
        ...(stepRatings[wordId] ?? {}),
        [stepKey]: rating,
      },
    }
    setStepRatings(nextStepRatings)

    // Decide: continue (more stages/words to do) OR finalize this word.
    const currentRetryQueue = retryStagesByWord[wordId] ?? []
    const willFinalize = isInRetry ? currentRetryQueue.length <= 1 : isLastStep

    if (!willFinalize) {
      // More stages to process on THIS word (retry) or move to next word (normal).
      if (isInRetry) {
        // Pop the just-completed stage from the retry queue.
        setRetryStagesByWord((prev) => ({
          ...prev,
          [wordId]: currentRetryQueue.slice(1),
        }))
      } else {
        goNextInRound()
      }
      if (isCardFlipped) {
        useAppStore.getState().toggleCard()
      }
      return
    }

    // Finalize path — read the word's full ratings including the one just applied.
    const stages = nextStepRatings[wordId] ?? {}
    const allRatings: Array<'again' | 'hard' | 'easy'> = [
      stages.pronunciation ?? 'easy',
      stages.recognition ?? 'easy',
      stages.recall ?? 'easy',
    ]
    const cycleDelta = allRatings.reduce((sum, item) => sum + getDebtDelta(item), 0)
    const currentDebt = debtByWord[wordId] ?? 0
    // Natural decay: each completed cycle decreases debt by 1 before this cycle's score impact.
    const nextDebt = Math.max(0, currentDebt - 1 + cycleDelta)
    const repeatCount = repeatCountByWord[wordId] ?? 0
    const hasAgainInCycle = allRatings.includes('again')
    const shouldRepeatToday = hasAgainInCycle || (nextDebt >= 2 && repeatCount < 3)

    setDebtByWord((prev) => ({
      ...prev,
      [wordId]: nextDebt,
    }))

    if (shouldRepeatToday) {
      setRepeatCountByWord((prev) => ({
        ...prev,
        [wordId]: repeatCount + 1,
      }))
      // Only redo the stages that were rated 'again' this cycle. If ONLY
      // recall failed, retry queue = [2]. If pronunciation + recall failed,
      // retry = [0, 2]. If the debt threshold triggered a retry without any
      // explicit 'again' rating (rare), fall back to all-three so the user
      // gets a full re-round.
      const failedStages: number[] = []
      if (allRatings[0] === 'again') failedStages.push(0)
      if (allRatings[1] === 'again') failedStages.push(1)
      if (allRatings[2] === 'again') failedStages.push(2)
      if (failedStages.length === 0) failedStages.push(0, 1, 2)
      setRetryStagesByWord((prev) => ({ ...prev, [wordId]: failedStages }))
      // Keep stepRatings intact — retry stages will overwrite their own
      // slots, non-failed stages keep their previous non-again ratings.
      if (currentIndex < reviews.length - 1) {
        useAppStore.getState().goToNextReview()
      } else {
        useAppStore.getState().setReviewIndex(0)
      }
      if (isCardFlipped) {
        useAppStore.getState().toggleCard()
      }
      return
    }

    // Ready to submit — clear per-word bookkeeping. DO NOT clear the
    // retry queue here: doing so would let `effectiveStep` fall back to
    // the (unrelated) global stepIndex mid-transition, which briefly
    // renders the wrong step's UI before submitReview drops the word from
    // the queue. The stale entry is harmless once the wordId leaves
    // todayReviews. Session-scope resets (folder change) wipe it anyway.
    setStepRatings((prev) => {
      const next = { ...prev }
      delete next[wordId]
      return next
    })

    const repeatPenalty = repeatCountByWord[wordId] ?? 0
    let finalRating = toFinalRatingByDebt(nextDebt)
    // If this word repeated today, raise strictness so difficulty score reflects
    // "kept forgetting then recalled" instead of being washed out by last easy click.
    if (repeatPenalty >= 2) {
      finalRating = 'again'
    } else if (repeatPenalty >= 1 && finalRating === 'easy') {
      finalRating = 'hard'
    }
    // Snapshot the pre-submission FSRS state if this word is about to be
    // submitted as `again`. Used by the rescue panel at session-done to let
    // the user fix a misclick.
    if (finalRating === 'again' && currentReview) {
      const snapshot: ReviewSnapshot = {
        interval: currentReview.interval ?? 1,
        repetition: currentReview.repetition ?? 0,
        easeFactor: currentReview.easeFactor ?? 2.5,
        difficultyScore: currentReview.difficultyScore ?? 0,
        recentRatings: currentReview.recentRatings ?? '',
        firstLearnedAt: currentReview.firstLearnedAt ?? null,
        lastReviewedAt: currentReview.lastReviewedAt ?? null,
      }
      setAgainEntries((prev) => [
        ...prev,
        {
          wordId,
          word: currentWord?.word ?? '',
          meaning: currentWord?.meaning ?? '',
          snapshot,
        },
      ])
    }
    // Bump per-session rating counter BEFORE submit so a network failure
    // still leaves the stats meaningful. Counts each word once (the loop
    // above already returned early on repeat cycles).
    //
    // Classification: if the word had ANY `again` in this session (at any
    // step, any cycle), we bin it as Again in the recap regardless of the
    // FSRS finalRating. The user asked for this — they want the recap to
    // reflect "I struggled with this one" rather than "I eventually got it".
    // FSRS finalRating (submitted to server) is untouched.
    const wasEverAgain = hadAgainByWord[wordId] === true || finalRating === 'again'
    const displayRating: 'again' | 'hard' | 'easy' = wasEverAgain
      ? 'again'
      : finalRating
    setSessionStats((prev) => ({
      ...prev,
      easy: prev.easy + (displayRating === 'easy' ? 1 : 0),
      hard: prev.hard + (displayRating === 'hard' ? 1 : 0),
      again: prev.again + (displayRating === 'again' ? 1 : 0),
    }))
    await useAppStore.getState().submitReview(finalRating)
    setDebtByWord((prev) => {
      const next = { ...prev }
      delete next[wordId]
      return next
    })
    setRepeatCountByWord((prev) => {
      const next = { ...prev }
      delete next[wordId]
      return next
    })
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target

      // Allow shortcuts when focus is on a disabled input (e.g. after recall reveal).
      const isEnabledFormControl =
        target instanceof HTMLElement &&
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) &&
        !(target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).disabled

      if (isEnabledFormControl) {
        return
      }

      if (event.code === 'Space' && currentWord) {
        event.preventDefault()
        useAppStore.getState().toggleCard()
      }

      if ((event.key === 'p' || event.key === 'P') && currentWord) {
        event.preventDefault()
        speak(
          pickSpeakableText(currentWord.word, currentWord.reading, currentWord.language),
          currentWord.language,
        )
      }

      if (event.key === 'Enter' && currentWord && !isSubmitting) {
        if (currentStep.key === 'recall') {
          if (recallStatus === 'correct') {
            event.preventDefault()
            void handleStepRating(recallUsedHint ? 'hard' : 'easy')
          } else if (recallStatus === 'wrong') {
            event.preventDefault()
            void handleStepRating('again')
          }
        } else {
          // Stages 1 (pronunciation) and 2 (recognition): Enter = Easy.
          // No card-flip requirement — the user asked for a straight
          // "I got this, next" shortcut for these two stages. Recall stage
          // has its own Enter behavior wired to the typed-answer verdict.
          event.preventDefault()
          void handleStepRating('easy')
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      stopSpeaking()
    }
  }, [currentWord, isCardFlipped, currentStep.key, recallStatus, recallUsedHint, isSubmitting])

  useEffect(() => {
    if (currentStep.key !== 'pronunciation' || !currentWord) return
    const speakText = pickSpeakableText(
      currentWord.word,
      currentWord.reading,
      currentWord.language,
    )
    // Delay the first speak: voices may still be loading on first page hit, and
    // sibling effects' cleanup (stopSpeaking) needs to settle before we queue.
    const id = window.setTimeout(() => {
      speak(speakText, currentWord.language)
    }, 250)
    return () => window.clearTimeout(id)
  }, [
    currentStep.key,
    currentReview?.wordId,
    currentWord?.word,
    currentWord?.reading,
    currentWord?.language,
  ])

  useEffect(() => {
    setTypedRecall('')
    setRecallStatus('idle')
    setRecallUsedHint(false)
  }, [currentStep.key, currentReview?.wordId])

  // After moving to the next word inside the recall step, re-focus the input —
  // autoFocus only fires on first mount, so swapping to a new word keeps it blurred.
  useEffect(() => {
    if (currentStep.key !== 'recall') return
    if (recallStatus !== 'idle') return
    const id = window.setTimeout(() => recallInputRef.current?.focus(), 0)
    return () => window.clearTimeout(id)
  }, [currentStep.key, currentReview?.wordId, recallStatus])

  const katakanaToHiragana = (value: string) =>
    value.replace(/[ァ-ヶ]/g, (ch) =>
      String.fromCharCode(ch.charCodeAt(0) - 0x60),
    )
  const normalizeAnswer = (value: string) =>
    katakanaToHiragana(value.trim().toLowerCase()).replace(/\s+/g, ' ')

  const isRecallCorrect = (typed: string) => {
    if (!currentWord) return false
    const candidate = normalizeAnswer(typed)
    if (!candidate) return false
    if (candidate === normalizeAnswer(currentWord.word)) return true
    if (currentWord.reading && candidate === normalizeAnswer(currentWord.reading))
      return true
    return false
  }

  const handleRecallSubmit = () => {
    if (recallStatus !== 'idle') return
    if (!typedRecall.trim()) return
    if (isRecallCorrect(typedRecall)) {
      setRecallStatus('correct')
    } else {
      setRecallStatus('wrong')
    }
  }

  const handleRecallHint = () => {
    if (!currentWord || recallStatus !== 'idle') return
    stopSpeaking()
    speak(
      pickSpeakableText(currentWord.word, currentWord.reading, currentWord.language),
      currentWord.language,
    )
    setRecallUsedHint(true)
  }

  const handleRecallForgot = () => {
    if (recallStatus !== 'idle') return
    setRecallStatus('wrong')
  }

  if (isLoadingReviews) {
    return (
      <section className="page">
        <div className="card review-card state-card">
          <div className="state-illustration">...</div>
          <h2>{t('review.loading')}</h2>
          <p className="muted">{t('review.loadingHint')}</p>
          <div className="actions">
            <Button variant="outline"
              type="button"
              onPress={() => {
                void useAppStore.getState().fetchFolders()
                void useAppStore.getState().fetchTodayReviews()
              }}
            >
              {t('review.retry')}
            </Button>
          </div>
        </div>
      </section>
    )
  }

  if (!currentReview || !currentWord) {
    const folderFilterLabel = reviewFolderId
      ? folderList.find((f) => f.id === reviewFolderId)?.name ?? ''
      : null
    const pendingFixes = Object.entries(correctionDraft)
    const applyCorrections = async () => {
      if (pendingFixes.length === 0) return
      setIsApplyingCorrection(true)
      try {
        for (const [wordId, newRating] of pendingFixes) {
          const entry = againEntries.find((e) => e.wordId === wordId)
          if (!entry) continue
          try {
            await correctReviewResult({
              wordId,
              snapshot: entry.snapshot,
              newRating,
            })
          } catch {
            // skip; remaining fixes still apply
          }
        }
        // Remove fixed entries from the rescue list so the panel hides when
        // all are handled. We DON'T remove "keep again" entries — those are
        // explicit user decisions, but the unchanged entry is fine to leave
        // visible until the user navigates away.
        setAgainEntries((prev) =>
          prev.filter((entry) => !(entry.wordId in correctionDraft)),
        )
        setCorrectionDraft({})
        setCorrectionApplied(true)
      } finally {
        setIsApplyingCorrection(false)
      }
    }

    return (
      <section className="page">
        <div className="card review-card state-card">
          <div className="state-illustration">100%</div>
          <h2>
            {reviewFolderId ? t('review.sessionDoneFolder') : t('review.sessionDoneTitle')}
          </h2>
          <p className="muted">
            {reviewFolderId
              ? t('review.sessionDoneWithFolder', { name: folderFilterLabel ?? '' })
              : t('review.sessionDoneNoFolder')}
          </p>

          {(() => {
            const total = sessionStats.easy + sessionStats.hard + sessionStats.again
            if (total === 0) return null
            // "Correctness rate" counts Easy + Hard as understood, Again as
            // wrong. Hard is included because after FSRS it still marks
            // "user recalled", just with more effort.
            const correct = sessionStats.easy + sessionStats.hard
            const rate = Math.round((correct / total) * 100)
            return (
              <div className="mx-auto mt-4 max-w-[420px] rounded-xl bg-indigo-500/6 px-4 py-3.5 text-left">
                <div className="mb-2.5 flex items-baseline gap-2">
                  <span className="text-[32px] leading-none font-bold text-indigo-600">{rate}%</span>
                  <span className="muted">
                    {' '}
                    正确率 · 共 {total} 词
                  </span>
                </div>
                <ul className="m-0 flex list-none flex-wrap gap-4 p-0 text-[13px] text-foreground [&>li]:inline-flex [&>li]:items-center [&>li]:gap-1.5 [&_strong]:font-semibold [&_strong]:text-foreground [&_.dot]:inline-block [&_.dot]:size-2 [&_.dot]:rounded-full [&_.dot-easy]:bg-green-500 [&_.dot-hard]:bg-amber-500 [&_.dot-again]:bg-red-500">
                  <li>
                    <span className="dot dot-easy" aria-hidden></span>
                    Easy <strong>{sessionStats.easy}</strong>
                  </li>
                  <li>
                    <span className="dot dot-hard" aria-hidden></span>
                    Hard <strong>{sessionStats.hard}</strong>
                  </li>
                  <li>
                    <span className="dot dot-again" aria-hidden></span>
                    Again <strong>{sessionStats.again}</strong>
                  </li>
                </ul>
              </div>
            )
          })()}

          {againEntries.length > 0 ? (
            <div className="mx-auto mt-4 max-w-[520px] rounded-xl border border-danger/18 bg-danger/6 px-4 py-3.5 text-left">
              <div className="mb-2.5 flex flex-col gap-0.5 [&>strong]:text-sm [&>strong]:text-red-700 [&>.muted]:text-xs">
                <strong>{t('review.againRescueTitle', { count: againEntries.length })}</strong>
                <span className="muted">{t('review.againRescueHint')}</span>
              </div>
              <ul className="m-0 grid list-none gap-2 p-0">
                {againEntries.map((entry) => {
                  const draft = correctionDraft[entry.wordId]
                  return (
                    <li key={entry.wordId} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-white/60 px-2.5 py-2">
                      <div className="flex min-w-0 flex-[1_1_160px] items-baseline gap-1.5 [&>strong]:text-[15px] [&>strong]:text-foreground">
                        <strong>{entry.word}</strong>
                        {entry.meaning ? (
                          <span className="muted">· {entry.meaning}</span>
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
                              delete next[entry.wordId]
                              return next
                            })
                          }
                          isDisabled={isApplyingCorrection}
                        >
                          {t('review.againRescueKeep')}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant={draft === 'hard' ? 'primary' : 'outline'}
                          className="text-xs"
                          onPress={() =>
                            setCorrectionDraft((prev) => ({
                              ...prev,
                              [entry.wordId]: 'hard',
                            }))
                          }
                          isDisabled={isApplyingCorrection}
                        >
                          {t('review.againRescueToHard')}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant={draft === 'easy' ? 'primary' : 'outline'}
                          className="text-xs"
                          onPress={() =>
                            setCorrectionDraft((prev) => ({
                              ...prev,
                              [entry.wordId]: 'easy',
                            }))
                          }
                          isDisabled={isApplyingCorrection}
                        >
                          {t('review.againRescueToEasy')}
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
                    ? t('review.againRescueApplying')
                    : t('review.againRescueApply', { count: pendingFixes.length })}
                </Button>
                {correctionApplied ? (
                  <span className="muted">{t('review.againRescueApplied')}</span>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="actions">
            <Link className="button button--primary" to="/learn">
              {t('review.goLearn')}
            </Link>
            <Link className="button button--outline" to="/words/new">
              {t('review.addWord')}
            </Link>
            <Link className="button button--outline" to="/folders">
              {t('review.viewFolders')}
            </Link>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="page">
      <div className="card review-card">
        <div className="review-meta">
          <div className="review-progress-copy">
            <p className="eyebrow">{t('review.progressLabel')}</p>
            <strong className="progress-text">
              {currentWordPosition} / {totalReviewCount}
            </strong>
          </div>
          <div className="flex flex-wrap items-center gap-3 max-md:w-full max-md:gap-2">
            <label className="session-inline">
              <span className="muted">{t('review.folderLabel')}</span>
              <SelectField
                value={reviewFolderId ?? ''}
                isDisabled={isLoadingFolders || isLoadingReviews}
                onChange={(v) => {
                  const next = v === '' ? null : v
                  useAppStore.getState().setReviewFolderId(next)
                  void useAppStore.getState().fetchTodayReviews()
                }}
              className="min-w-[160px]"
                options={[
                  { value: '', label: t('review.allFolders') },
                  ...folderList.map((folder) => ({
                    value: folder.id,
                    label: folder.name,
                  })),
                ]}
              />
            </label>
            <span className="review-tag">{currentWord.folder.name}</span>
          </div>
        </div>

        <div className="my-1 mb-1.5 flex flex-wrap justify-center gap-2">
          {REVIEW_STEPS.map((step, idx) => (
            <span
              key={step.key}
              className={`${STEP_PILL} ${
                idx === stepIndex
                  ? STEP_ACTIVE
                  : idx < stepIndex
                    ? STEP_DONE
                    : 'border-border bg-white text-muted'
              }`}
            >
              {idx + 1}. {step.label}
            </span>
          ))}
        </div>
        <p className="muted mx-0 mt-0 mb-3.5 text-[13px]">{currentStep.hint}</p>

        <VoicePicker
          lang={currentWord.language}
          sampleText={currentWord.word}
        />

        <div
          className="progress-track"
          aria-label={`review progress ${completedCards} of ${totalCards}`}
        >
          <span className="progress-bar" style={{ width: `${progressPercent}%` }} />
        </div>

        {currentStep.key === 'recall' ? (
          <div className="recall-block">
            <p className="recall-prompt-label">{t('review.recallLabel')}</p>
            <p className="recall-prompt-text">
              {currentWord.meaning || currentWord.note || t('review.meaningEmpty')}
            </p>
            {currentWord.partOfSpeech ? (
              <p className="muted recall-pos">
                {t('review.partOfSpeechLabel', { value: currentWord.partOfSpeech })}
              </p>
            ) : null}

            <div className="recall-input-row">
              <input
                ref={recallInputRef}
                type="text"
                className="recall-input"
                value={typedRecall}
                onChange={(event) => setTypedRecall(event.target.value)}
                onKeyDown={(event) => {
                  // Skip Enter fired while an IME composition is still open
                  // (e.g. Japanese IME confirming a kanji candidate) — those
                  // shouldn't submit the answer. `keyCode === 229` is the
                  // legacy signal for "IME is handling this key".
                  if (
                    event.key === 'Enter' &&
                    !event.nativeEvent.isComposing &&
                    event.keyCode !== 229
                  ) {
                    event.preventDefault()
                    event.stopPropagation()
                    handleRecallSubmit()
                  }
                }}
                placeholder={
                  currentWord.language === 'jp'
                    ? t('review.inputPlaceholderJp')
                    : t('review.inputPlaceholderEn')
                }
                disabled={recallStatus !== 'idle'}
                autoFocus
              />
              {recallStatus === 'idle' ? (
                <>
                  <Button variant="outline"
                    type="button"
                    onPress={handleRecallHint}
                    render={(props) => <button {...props} title={t('review.hint')} />}
                  >
                    <Volume2 /> {t('review.hint')}
                  </Button>
                  <Button variant="outline" size="sm"
                    type="button"
                    onPress={handleRecallForgot}
                    render={(props) => <button {...props} title={t('review.forgot')} />}
                  >
                    {t('review.forgot')}
                  </Button>
                  <Button
                    type="button"
                    isDisabled={!typedRecall.trim()}
                    onPress={handleRecallSubmit}
                  >
                    {t('review.submit')}
                  </Button>
                </>
              ) : null}
            </div>

            {recallStatus === 'correct' ? (
              <div className="recall-feedback recall-feedback-correct">
                <p>
                  <strong>{t('review.correct')}</strong>
                </p>
                <div className="recall-reveal">
                  <strong>{currentWord.word}</strong>
                  {currentWord.reading ? (
                    <span className="muted">{currentWord.reading}</span>
                  ) : null}
                  <SpeakButton
                    text={currentWord.word} reading={currentWord.reading}
                    lang={currentWord.language}
                    size="md"
                    label={t('review.readWord')}
                  />
                </div>
                {currentWord.example ? (
                  <p className="muted multiline-text">{currentWord.example}</p>
                ) : null}
              </div>
            ) : null}

            {recallStatus === 'wrong' ? (
              <div className="recall-feedback recall-feedback-wrong">
                <p>
                  <strong>{t('review.wrong')}</strong>
                  <span className="muted">  {t('review.yourInput', { value: typedRecall })}</span>
                </p>
                <div className="recall-reveal">
                  <span className="muted">{t('review.correctAnswer')}</span>
                  <strong>{currentWord.word}</strong>
                  {currentWord.reading ? (
                    <span className="muted">{currentWord.reading}</span>
                  ) : null}
                  <SpeakButton
                    text={currentWord.word} reading={currentWord.reading}
                    lang={currentWord.language}
                    size="md"
                    label={t('review.readWord')}
                  />
                </div>
                {currentWord.example ? (
                  <p className="muted multiline-text">{currentWord.example}</p>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {currentStep.key !== 'recall' ? (
        <>
        <button
          type="button"
          className={`flip-card ${isCardFlipped ? 'is-flipped' : ''}`}
          onClick={() => useAppStore.getState().toggleCard()}
          aria-label="翻转单词卡片"
        >
          <span className="flip-card-face flip-card-front">
            <span className="card-label">{t('review.cardFront')}</span>
            {currentStep.key === 'recognition' ? (
              <span className="inline-flex flex-wrap items-center justify-center gap-3">
                <strong>{currentWord.word}</strong>
                <SpeakButton
                  text={currentWord.word} reading={currentWord.reading}
                  lang={currentWord.language}
                  size="md"
                  label="朗读单词"
                />
              </span>
            ) : null}
            <small className="inline-flex min-h-6 items-center justify-center">
              {currentWord.partOfSpeech ? t('review.partOfSpeech', { value: currentWord.partOfSpeech }) : '\u00A0'}
            </small>
            {currentStep.key === 'pronunciation' ? (
              <div className="flex flex-col items-center gap-4 py-4">
                <button
                  type="button"
                  className="inline-flex size-24 min-h-0 cursor-pointer items-center justify-center rounded-full border-none bg-linear-135 from-accent to-blue-700 p-0 text-[38px] text-white shadow-[0_8px_24px_rgba(37,99,235,0.32)] transition-[transform,box-shadow] duration-150 hover:scale-104 hover:shadow-[0_12px_30px_rgba(37,99,235,0.42)] active:scale-97"
                  onClick={(e) => {
                    e.stopPropagation()
                    speak(
                      pickSpeakableText(currentWord.word, currentWord.reading, currentWord.language),
                      currentWord.language,
                    )
                  }}
                  aria-label="听音"
                >
                  <Volume2 />
                </button>
                <small className="text-xs tracking-[0.02em] text-black/40">P 再听 · 空格翻卡看答案</small>
              </div>
            ) : null}
          </span>
          <span className="flip-card-face flip-card-back">
            <span className="card-label">{t('review.cardBack')}</span>
            {currentStep.key === 'recognition' ? (
              <>
                <strong className="multiline-text">{currentWord.meaning || t('review.meaningEmpty')}</strong>
                {currentWord.reading ? (
                  <small>{t('review.readingLabel', { value: currentWord.reading })}</small>
                ) : null}
                <small className="inline-flex min-h-6 items-center justify-center">
                  {currentWord.partOfSpeech ? t('review.partOfSpeech', { value: currentWord.partOfSpeech }) : '\u00A0'}
                </small>
                <small className="multiline-text">{currentWord.example}</small>
                <small>{currentWord.note}</small>
              </>
            ) : null}
            {currentStep.key === 'pronunciation' ? (
              <>
                <strong>{currentWord.word}</strong>
                {currentWord.reading ? (
                  <small>{t('review.readingLabel', { value: currentWord.reading })}</small>
                ) : null}
                <small className="inline-flex min-h-6 items-center justify-center">
                  {currentWord.partOfSpeech ? t('review.partOfSpeech', { value: currentWord.partOfSpeech }) : '\u00A0'}
                </small>
                <small className="multiline-text">
                  {currentWord.meaning || t('review.meaningEmpty')}
                </small>
                {currentWord.example ? (
                  <small className="multiline-text">{currentWord.example}</small>
                ) : null}
              </>
            ) : null}
          </span>
        </button>

        <div className="actions rating-actions">
          <div className="rating-action">
            <button
              type="button"
              className={`${RATING_BTN} ${RATING_TONE.again}`}
              disabled={isSubmitting}
              onClick={() => void handleStepRating('again')}
            >
              {t('review.againButton')}
            </button>
            <span className="rating-caption">{t('review.againCaption')}</span>
          </div>
          <div className="rating-action">
            <button
              type="button"
              className={`${RATING_BTN} ${RATING_TONE.hard}`}
              disabled={isSubmitting}
              onClick={() => void handleStepRating('hard')}
            >
              {t('review.hardButton')}
            </button>
            <span className="rating-caption">{t('review.hardCaption')}</span>
          </div>
          <div className="rating-action">
            <button
              type="button"
              className={`${RATING_BTN} ${RATING_TONE.easy}`}
              disabled={isSubmitting}
              onClick={() => void handleStepRating('easy')}
            >
              {t('review.easyButton')}
            </button>
            <span className="rating-caption">{t('review.easyCaption')}</span>
          </div>
          {!isLastStep ? (
            <div className="rating-action">
              <button
                type="button"
                className={`${RATING_BTN} ${RATING_TONE.skip}`}
                disabled={isSubmitting}
                onClick={handleSkipStep}
                title="跳过整个步骤,直接进入下一步"
              >
                跳过此步骤
              </button>
              <span className="rating-caption">直接进入下一步</span>
            </div>
          ) : null}
        </div>
        </>
        ) : null}

        {currentStep.key === 'recall' && recallStatus === 'correct' ? (
          <div className="actions rating-actions">
            <div className="rating-action">
              <button
                type="button"
                className={`${RATING_BTN} ${RATING_TONE.hard}`}
                disabled={isSubmitting}
                onClick={() => void handleStepRating('hard')}
              >
                {t('review.hardButton')}
              </button>
              <span className="rating-caption">
                {recallUsedHint
                  ? t('review.hardCaptionWithHint')
                  : t('review.hardCaptionWithoutHint')}
              </span>
            </div>
            {!recallUsedHint ? (
              <div className="rating-action">
                <button
                  type="button"
                  className={`${RATING_BTN} ${RATING_TONE.easy}`}
                  disabled={isSubmitting}
                  onClick={() => void handleStepRating('easy')}
                >
                  {t('review.easyButton')}
                </button>
                <span className="rating-caption">{t('review.easyCaptionOnce')}</span>
              </div>
            ) : null}
          </div>
        ) : null}

        {currentStep.key === 'recall' && recallStatus === 'wrong' ? (
          <div className="actions">
            <button
              type="button"
              className={`${RATING_BTN} ${RATING_TONE.again}`}
              disabled={isSubmitting}
              onClick={() => void handleStepRating('again')}
            >
              {t('review.againWrong')}
            </button>
          </div>
        ) : null}

        {/* AI Quiz is temporarily disabled. */}

        {error ? <p className="error-text">{error}</p> : null}
      </div>
    </section>
  )
}
