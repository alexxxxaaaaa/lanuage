import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { SpeakButton } from '../components/SpeakButton'
import { VoicePicker } from '../components/VoicePicker'
import { useAppStore } from '../store/useAppStore'
import { speak, stopSpeaking } from '../utils/speech'

const REVIEW_STEPS = [
  { key: 'recognition', label: '识别', hint: '看单词，先回忆释义' },
  { key: 'recall', label: '回忆', hint: '看释义，回忆单词拼写' },
  { key: 'pronunciation', label: '发音', hint: '朗读单词并听例句' },
] as const

export function ReviewPage() {
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
    Record<string, Partial<Record<(typeof REVIEW_STEPS)[number]['key'], 'again' | 'hard' | 'easy'>>>
  >({})
  const [debtByWord, setDebtByWord] = useState<Record<string, number>>({})
  const [repeatCountByWord, setRepeatCountByWord] = useState<Record<string, number>>({})
  const [typedRecall, setTypedRecall] = useState('')
  const [recallStatus, setRecallStatus] = useState<'idle' | 'correct' | 'wrong'>('idle')

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

      if (
        target instanceof HTMLElement &&
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
      ) {
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
            void handleStepRating('easy')
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
  }, [currentWord, isCardFlipped, currentStep.key, recallStatus, isSubmitting])

  useEffect(() => {
    if (currentStep.key !== 'pronunciation' || !currentWord) return
    speak(currentWord.word, currentWord.language)
  }, [currentStep.key, currentReview?.wordId, currentWord?.word, currentWord?.language])

  useEffect(() => {
    setTypedRecall('')
    setRecallStatus('idle')
  }, [currentStep.key, currentReview?.wordId])

  const normalizeAnswer = (value: string) =>
    value.trim().toLowerCase().replace(/\s+/g, ' ')

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

  if (isLoadingReviews) {
    return (
      <section className="page">
        <div className="card review-card state-card">
          <div className="state-illustration">...</div>
          <h2>正在加载今日复习...</h2>
          <p className="muted">系统正在准备今天需要复习的单词。</p>
          <div className="actions">
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                void useAppStore.getState().fetchFolders()
                void useAppStore.getState().fetchTodayReviews()
              }}
            >
              重试
            </button>
          </div>
        </div>
      </section>
    )
  }

  if (!currentReview || !currentWord) {
    const folderFilterLabel = reviewFolderId
      ? folderList.find((f) => f.id === reviewFolderId)?.name ?? '当前分类'
      : null

    return (
      <section className="page">
        <div className="card review-card state-card">
          <div className="state-illustration">100%</div>
          <h2>{reviewFolderId ? '本分类复习已结束' : '今天已经复习完啦'}</h2>
          <p className="muted">
            {reviewFolderId
              ? `「${folderFilterLabel}」下当前没有更多到期的单词。可切换到“全部”继续复习。`
              : '当前没有到期单词，可以先去添加单词或查看分类。'}
          </p>
          <div className="actions">
            <Link className="primary-link" to="/learn">
              去学习新词
            </Link>
            <Link className="secondary-link" to="/words/new">
              添加单词
            </Link>
            <Link className="secondary-link" to="/folders">
              查看分类
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
            <p className="eyebrow">Review Session</p>
            <strong className="progress-text">
              {currentWordPosition} / {totalReviewCount}
            </strong>
          </div>
          <div className="review-meta-right">
            <label className="session-inline">
              <span className="muted">分类</span>
              <select
                value={reviewFolderId ?? ''}
                disabled={isLoadingFolders || isLoadingReviews}
                onChange={(event) => {
                  const next = event.target.value === '' ? null : event.target.value
                  useAppStore.getState().setReviewFolderId(next)
                  void useAppStore.getState().fetchTodayReviews()
                }}
              >
                <option value="">全部</option>
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
          本词难度积分：{debtByWord[currentReview.wordId] ?? 0}（≥3 计入 Again，≥1 计入 Hard，否则 Easy）
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
            <p className="recall-prompt-label">请输入这个意思对应的单词</p>
            <p className="recall-prompt-text">
              {currentWord.meaning || currentWord.note || '（无释义）'}
            </p>
            {currentWord.partOfSpeech ? (
              <p className="muted recall-pos">词性：{currentWord.partOfSpeech}</p>
            ) : null}

            <div className="recall-input-row">
              <input
                type="text"
                className="recall-input"
                value={typedRecall}
                onChange={(event) => setTypedRecall(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') handleRecallSubmit()
                }}
                placeholder={
                  currentWord.language === 'jp'
                    ? '输入单词（汉字或假名都可）'
                    : '输入单词'
                }
                disabled={recallStatus !== 'idle'}
                autoFocus
              />
              {recallStatus === 'idle' ? (
                <button
                  type="button"
                  className="primary-button"
                  disabled={!typedRecall.trim()}
                  onClick={handleRecallSubmit}
                >
                  提交
                </button>
              ) : null}
            </div>

            {recallStatus === 'correct' ? (
              <div className="recall-feedback recall-feedback-correct">
                <p>
                  <strong>✓ 正确</strong>
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
                    label="朗读单词"
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
                  <strong>✗ 答错了</strong>
                  <span className="muted">  你输入：{typedRecall}</span>
                </p>
                <div className="recall-reveal">
                  <span className="muted">正确答案：</span>
                  <strong>{currentWord.word}</strong>
                  {currentWord.reading ? (
                    <span className="muted">{currentWord.reading}</span>
                  ) : null}
                  <SpeakButton
                    text={currentWord.word} reading={currentWord.reading}
                    lang={currentWord.language}
                    size="md"
                    label="朗读单词"
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
            <span className="card-label">正面 · 空格翻卡 · P 朗读</span>
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
              {currentWord.partOfSpeech ? `词性：${currentWord.partOfSpeech}` : '\u00A0'}
            </small>
            {currentStep.key === 'pronunciation' ? (
              <>
                <small>请先听发音，再猜单词</small>
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
            <span className="card-label">背面 · P 朗读单词</span>
            {currentStep.key === 'recognition' ? (
              <>
                <strong className="multiline-text">{currentWord.meaning || '（暂无释义）'}</strong>
                {currentWord.reading ? <small>读音：{currentWord.reading}</small> : null}
                <small className="part-of-speech-slot">
                  {currentWord.partOfSpeech ? `词性：${currentWord.partOfSpeech}` : '\u00A0'}
                </small>
                <small className="multiline-text">{currentWord.example}</small>
                <small>{currentWord.note}</small>
              </>
            ) : null}
            {currentStep.key === 'pronunciation' ? (
              <>
                <strong>{currentWord.word}</strong>
                {currentWord.reading ? <small>读音：{currentWord.reading}</small> : null}
                <small className="part-of-speech-slot">
                  {currentWord.partOfSpeech ? `词性：${currentWord.partOfSpeech}` : '\u00A0'}
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
              Again
            </button>
            <span className="rating-caption">记错 +2 · 重置进度</span>
          </div>
          <div className="rating-action">
            <button
              type="button"
              className="secondary-button"
              disabled={isSubmitting}
              onClick={() => void handleStepRating('hard')}
            >
              Hard
            </button>
            <span className="rating-caption">印象浅 +1 · 间隔×1.2</span>
          </div>
          <div className="rating-action">
            <button
              type="button"
              className="success-button"
              disabled={isSubmitting}
              onClick={() => void handleStepRating('easy')}
            >
              Easy
            </button>
            <span className="rating-caption">记得牢 −1 · 间隔×难度系数</span>
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
                Hard
              </button>
              <span className="rating-caption">写出来但不顺 +1</span>
            </div>
            <div className="rating-action">
              <button
                type="button"
                className="success-button"
                disabled={isSubmitting}
                onClick={() => void handleStepRating('easy')}
              >
                Easy
              </button>
              <span className="rating-caption">一次写对 −1</span>
            </div>
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
              继续（标记 Again）
            </button>
          </div>
        ) : null}

        {/* AI Quiz is temporarily disabled. */}

        {error ? <p className="error-text">{error}</p> : null}
      </div>
    </section>
  )
}
