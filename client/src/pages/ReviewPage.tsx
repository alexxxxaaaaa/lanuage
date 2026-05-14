import { useEffect, useMemo, useState } from 'react'
import { SoundOutlined } from '@ant-design/icons'
import { Link } from 'react-router-dom'
import { SpeakButton } from '../components/SpeakButton'
import { VoicePicker } from '../components/VoicePicker'
import { useI18n } from '../i18n'
import { useAppStore } from '../store/useAppStore'
import { speak, stopSpeaking } from '../utils/speech'

type ReviewStepKey = 'recognition' | 'recall' | 'pronunciation'

export function ReviewPage() {
  const { t } = useI18n()
  const REVIEW_STEPS = useMemo(
    () =>
      [
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
        {
          key: 'pronunciation' as const,
          label: t('review.stepPronunciation'),
          hint: t('review.stepPronunciationHint'),
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
  const [stepRatings, setStepRatings] = useState<
    Record<string, Partial<Record<ReviewStepKey, 'again' | 'hard' | 'easy'>>>
  >({})
  const [debtByWord, setDebtByWord] = useState<Record<string, number>>({})
  const [repeatCountByWord, setRepeatCountByWord] = useState<Record<string, number>>({})
  const [typedRecall, setTypedRecall] = useState('')
  const [recallStatus, setRecallStatus] = useState<'idle' | 'correct' | 'wrong'>('idle')
  const [recallUsedHint, setRecallUsedHint] = useState(false)

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
    useAppStore.getState().resetReviewSession()
  }, [reviewFolderId])

  const reviews = Array.isArray(todayReviews) ? todayReviews : []
  const currentReview = reviews[currentIndex]
  const currentWord = currentReview?.word
  const completedWords = Math.max(0, totalReviewCount - reviews.length)
  const currentStep = REVIEW_STEPS[stepIndex]
  const isLastStep = stepIndex === REVIEW_STEPS.length - 1
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

  const handleStepRating = async (rating: 'again' | 'hard' | 'easy') => {
    if (!currentReview) return
    const wordId = currentReview.wordId
    const stepKey = currentStep.key

    if (!isLastStep) {
      setStepRatings((prev) => ({
        ...prev,
        [wordId]: {
          ...(prev[wordId] ?? {}),
          [stepKey]: rating,
        },
      }))
      goNextInRound()
      return
    }

    const previous = stepRatings[wordId] ?? {}
    const allRatings: Array<'again' | 'hard' | 'easy'> = [
      previous.recognition ?? 'easy',
      previous.recall ?? 'easy',
      rating,
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
    setStepRatings((prev) => {
      const next = { ...prev }
      delete next[wordId]
      return next
    })

    if (shouldRepeatToday) {
      setRepeatCountByWord((prev) => ({
        ...prev,
        [wordId]: repeatCount + 1,
      }))

      if (currentIndex < reviews.length - 1) {
        useAppStore.getState().goToNextReview()
      } else {
        setStepIndex(0)
        useAppStore.getState().setReviewIndex(0)
      }
      if (isCardFlipped) {
        useAppStore.getState().toggleCard()
      }
      return
    }

    const repeatPenalty = repeatCountByWord[wordId] ?? 0
    let finalRating = toFinalRatingByDebt(nextDebt)
    // If this word repeated today, raise strictness so difficulty score reflects
    // "kept forgetting then recalled" instead of being washed out by last easy click.
    if (repeatPenalty >= 2) {
      finalRating = 'again'
    } else if (repeatPenalty >= 1 && finalRating === 'easy') {
      finalRating = 'hard'
    }
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
        speak(currentWord.word, currentWord.language)
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
        } else if (isCardFlipped) {
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
    speak(currentWord.word, currentWord.language)
  }, [currentStep.key, currentReview?.wordId, currentWord?.word, currentWord?.language])

  useEffect(() => {
    setTypedRecall('')
    setRecallStatus('idle')
    setRecallUsedHint(false)
  }, [currentStep.key, currentReview?.wordId])

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
    speak(currentWord.word, currentWord.language)
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
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                void useAppStore.getState().fetchFolders()
                void useAppStore.getState().fetchTodayReviews()
              }}
            >
              {t('review.retry')}
            </button>
          </div>
        </div>
      </section>
    )
  }

  if (!currentReview || !currentWord) {
    const folderFilterLabel = reviewFolderId
      ? folderList.find((f) => f.id === reviewFolderId)?.name ?? ''
      : null

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
          <div className="actions">
            <Link className="primary-link" to="/learn">
              {t('review.goLearn')}
            </Link>
            <Link className="secondary-link" to="/words/new">
              {t('review.addWord')}
            </Link>
            <Link className="secondary-link" to="/folders">
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
          <div className="review-meta-right">
            <label className="session-inline">
              <span className="muted">{t('review.folderLabel')}</span>
              <select
                value={reviewFolderId ?? ''}
                disabled={isLoadingFolders || isLoadingReviews}
                onChange={(event) => {
                  const next = event.target.value === '' ? null : event.target.value
                  useAppStore.getState().setReviewFolderId(next)
                  void useAppStore.getState().fetchTodayReviews()
                }}
              >
                <option value="">{t('review.allFolders')}</option>
                {folderList.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folder.name}
                  </option>
                ))}
              </select>
            </label>
            <span className="review-tag">{currentWord.folder.name}</span>
          </div>
        </div>

        <div className="review-stepper">
          {REVIEW_STEPS.map((step, idx) => (
            <span
              key={step.key}
              className={`review-step-pill ${idx === stepIndex ? 'active' : ''} ${
                idx < stepIndex ? 'done' : ''
              }`}
            >
              {idx + 1}. {step.label}
            </span>
          ))}
        </div>
        <p className="muted review-step-hint">{currentStep.hint}</p>
        <p className="muted review-step-hint">
          {t('review.difficultyTip', { score: debtByWord[currentReview.wordId] ?? 0 })}
        </p>

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
                type="text"
                className="recall-input"
                value={typedRecall}
                onChange={(event) => setTypedRecall(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
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
                  <button
                    type="button"
                    className="secondary-button hint-button"
                    onClick={handleRecallHint}
                    title={t('review.hint')}
                  >
                    <SoundOutlined /> {t('review.hint')}
                  </button>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={handleRecallForgot}
                    title={t('review.forgot')}
                  >
                    {t('review.forgot')}
                  </button>
                  <button
                    type="button"
                    className="primary-button"
                    disabled={!typedRecall.trim()}
                    onClick={handleRecallSubmit}
                  >
                    {t('review.submit')}
                  </button>
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
              <span className="flip-word-row">
                <strong>{currentWord.word}</strong>
                <SpeakButton
                  text={currentWord.word} reading={currentWord.reading}
                  lang={currentWord.language}
                  size="md"
                  label="朗读单词"
                />
              </span>
            ) : null}
            <small className="part-of-speech-slot">
              {currentWord.partOfSpeech ? t('review.partOfSpeech', { value: currentWord.partOfSpeech }) : '\u00A0'}
            </small>
            {currentStep.key === 'pronunciation' ? (
              <>
                <small>{t('review.cardListenFirst')}</small>
                <SpeakButton
                  text={currentWord.word} reading={currentWord.reading}
                  lang={currentWord.language}
                  size="md"
                  label="朗读单词"
                />
              </>
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
                <small className="part-of-speech-slot">
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
                <small className="part-of-speech-slot">
                  {currentWord.partOfSpeech ? t('review.partOfSpeech', { value: currentWord.partOfSpeech }) : '\u00A0'}
                </small>
                
                <small className="multiline-text">{currentWord.example || currentWord.meaning}</small>
              </>
            ) : null}
          </span>
        </button>

        <div className="actions rating-actions">
          <div className="rating-action">
            <button
              type="button"
              className="danger-button"
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
              className="secondary-button"
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
              className="success-button"
              disabled={isSubmitting}
              onClick={() => void handleStepRating('easy')}
            >
              {t('review.easyButton')}
            </button>
            <span className="rating-caption">{t('review.easyCaption')}</span>
          </div>
        </div>
        </>
        ) : null}

        {currentStep.key === 'recall' && recallStatus === 'correct' ? (
          <div className="actions rating-actions">
            <div className="rating-action">
              <button
                type="button"
                className="secondary-button"
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
                  className="success-button"
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
              className="danger-button"
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
