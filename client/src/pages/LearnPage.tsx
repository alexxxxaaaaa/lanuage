import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { submitReviewResult } from '../api/review'
import { getTodayNewWords } from '../api/words'
import { SpeakButton } from '../components/SpeakButton'
import { useAppStore } from '../store/useAppStore'
import type { ReviewRating, Word } from '../types'
import { speak, stopSpeaking } from '../utils/speech'

export function LearnPage() {
  const navigate = useNavigate()
  const reviewFolderId = useAppStore((state) => state.reviewFolderId)
  const sessionLimit = useAppStore((state) => state.sessionLimit)
  const todayReviews = useAppStore((state) => state.todayReviews)
  const dueCount = Array.isArray(todayReviews) ? todayReviews.length : 0
  const [words, setWords] = useState<Word[]>([])
  const [index, setIndex] = useState(0)
  const [phase, setPhase] = useState<'learn' | 'quiz' | 'done'>('learn')
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [typedAnswer, setTypedAnswer] = useState('')
  const [quizStatus, setQuizStatus] = useState<'idle' | 'correct' | 'wrong'>('idle')

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
        setWords(limited)
        setIndex(0)
        setPhase('learn')
      } catch {
        setError('加载今日新词失败')
      } finally {
        setIsLoading(false)
      }
    }
    void run()
  }, [reviewFolderId, sessionLimit])

  useEffect(() => {
    void useAppStore.getState().fetchTodayReviews()
  }, [reviewFolderId])

  const currentWord = words[index]
  const total = words.length
  const progress = total === 0 ? 0 : Math.round(((index + 1) / total) * 100)

  const folderName = useMemo(() => {
    if (!reviewFolderId) return '全部'
    const folders = useAppStore.getState().folders
    return folders.find((item) => item.id === reviewFolderId)?.name ?? '当前分类'
  }, [reviewFolderId])

  const moveNext = () => {
    if (index >= total - 1) {
      if (phase === 'learn') {
        setPhase('quiz')
        setIndex(0)
      } else {
        setPhase('done')
      }
      return
    }
    setIndex((prev) => prev + 1)
  }

  const handleRate = async (rating: ReviewRating) => {
    if (!currentWord) return
    setIsSubmitting(true)
    setError(null)
    try {
      await submitReviewResult({ wordId: currentWord.id, rating })
      setTypedAnswer('')
      setQuizStatus('idle')
      moveNext()
    } catch {
      setError('提交评分失败，请重试')
    } finally {
      setIsSubmitting(false)
    }
  }

  const normalizeAnswer = (value: string) =>
    value.trim().toLowerCase().replace(/\s+/g, ' ')

  const isQuizCorrect = () => {
    if (!currentWord) return false
    const candidate = normalizeAnswer(typedAnswer)
    if (!candidate) return false
    if (candidate === normalizeAnswer(currentWord.word)) return true
    if (currentWord.reading && candidate === normalizeAnswer(currentWord.reading))
      return true
    return false
  }

  const handleQuizSubmit = () => {
    if (quizStatus !== 'idle' || !typedAnswer.trim()) return
    setQuizStatus(isQuizCorrect() ? 'correct' : 'wrong')
  }

  useEffect(() => {
    setTypedAnswer('')
    setQuizStatus('idle')
  }, [phase, index])

  useEffect(() => {
    if (phase !== 'learn' || !currentWord) return
    stopSpeaking()
    speak(currentWord.word, currentWord.language)
  }, [phase, currentWord?.id, currentWord?.word, currentWord?.language])

  if (isLoading) {
    return (
      <section className="page">
        <div className="card learn-card state-card">
          <h2>正在准备学习清单...</h2>
          <p className="muted">按你设置的数量加载未学习单词。</p>
        </div>
      </section>
    )
  }

  if (total === 0) {
    return (
      <section className="page">
        <div className="card learn-card state-card">
          <h2>暂无可学习单词</h2>
          <p className="muted">
            当前分类下没有“未学习”单词（repetition=0）。
            {dueCount > 0
              ? `你今天还有 ${dueCount} 个到期单词需要复习。`
              : '你可以先添加新词。'}
          </p>
          <div className="actions">
            {dueCount > 0 ? (
              <button
                type="button"
                className="primary-button"
                onClick={() => navigate('/review')}
              >
                现在去复习 {dueCount} 个到期词
              </button>
            ) : null}
            <Link
              className={dueCount > 0 ? 'secondary-link' : 'primary-link'}
              to="/words/new"
            >
              去添加单词
            </Link>
          </div>
        </div>
      </section>
    )
  }

  if (phase === 'done' || !currentWord) {
    return (
      <section className="page">
        <div className="card learn-card state-card">
          <h2>学习完成</h2>
          <p className="muted">
            今天新增词已学习并评分完成。
            {dueCount > 0
              ? `还有 ${dueCount} 个到期单词等你复习。`
              : '今天没有需要复习的到期单词。'}
          </p>
          <div className="actions">
            {dueCount > 0 ? (
              <button
                type="button"
                className="primary-button"
                onClick={() => navigate('/review')}
              >
                现在去复习 {dueCount} 个到期词
              </button>
            ) : null}
            <Link
              className={dueCount > 0 ? 'secondary-link' : 'primary-link'}
              to="/"
            >
              回首页
            </Link>
          </div>
        </div>
      </section>
    )
  }

  if (phase === 'learn') {
    return (
      <section className="page">
        <div className="card learn-card">
          <div className="learn-top">
            <div>
              <p className="eyebrow">Learn Mode</p>
              <h2>今日新词学习（{folderName}）</h2>
              <p className="muted">
                第 {index + 1} / {total} 个
              </p>
            </div>
            <span className="learn-limit-pill">
              本次学习 {sessionLimit === null ? '全部' : sessionLimit} 个
            </span>
          </div>
          <div className="progress-track">
            <span className="progress-bar" style={{ width: `${progress}%` }} />
          </div>
          <div className="word-card-title learn-word-row">
            <strong className="word-title">{currentWord.word}</strong>
            <SpeakButton text={currentWord.word} lang={currentWord.language} size="md" />
            <span className="muted word-reading">{currentWord.reading}</span>
          </div>
          {currentWord.partOfSpeech ? (
            <p className="muted">词性：{currentWord.partOfSpeech}</p>
          ) : null}
          {currentWord.meaning ? (
            <div className="learn-section">
              <p className="learn-label">释义</p>
              <p className="learn-text">{currentWord.meaning}</p>
            </div>
          ) : null}
          {currentWord.example ? (
            <div className="learn-section">
              <p className="learn-label">例句</p>
              <p className="word-example-text">{currentWord.example}</p>
            </div>
          ) : null}
          {currentWord.note ? (
            <div className="learn-section">
              <p className="learn-label">笔记</p>
              <p className="muted learn-note">{currentWord.note}</p>
            </div>
          ) : null}
          <div className="actions">
            <button type="button" className="primary-button" onClick={moveNext}>
              {index >= total - 1 ? '进入记忆测试' : '下一个'}
            </button>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="page">
      <div className="card learn-card">
        <div className="learn-top">
          <div>
            <p className="eyebrow">Quiz Mode</p>
            <h2>记忆测试（Again / Hard / Easy）</h2>
            <p className="muted">
              第 {index + 1} / {total} 个
            </p>
          </div>
          <span className="learn-limit-pill">
            本次学习 {sessionLimit === null ? '全部' : sessionLimit} 个
          </span>
        </div>
        <div className="progress-track">
          <span className="progress-bar" style={{ width: `${progress}%` }} />
        </div>
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
              value={typedAnswer}
              onChange={(event) => setTypedAnswer(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') handleQuizSubmit()
              }}
              placeholder={
                currentWord.language === 'jp'
                  ? '输入单词（汉字或假名都可）'
                  : '输入单词'
              }
              disabled={quizStatus !== 'idle'}
              autoFocus
            />
            {quizStatus === 'idle' ? (
              <button
                type="button"
                className="primary-button"
                disabled={!typedAnswer.trim()}
                onClick={handleQuizSubmit}
              >
                提交
              </button>
            ) : null}
          </div>

          {quizStatus === 'correct' ? (
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
                  text={currentWord.word}
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

          {quizStatus === 'wrong' ? (
            <div className="recall-feedback recall-feedback-wrong">
              <p>
                <strong>✗ 答错了</strong>
                <span className="muted">  你输入：{typedAnswer}</span>
              </p>
              <div className="recall-reveal">
                <span className="muted">正确答案：</span>
                <strong>{currentWord.word}</strong>
                {currentWord.reading ? (
                  <span className="muted">{currentWord.reading}</span>
                ) : null}
                <SpeakButton
                  text={currentWord.word}
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

        {quizStatus === 'correct' ? (
          <div className="actions rating-actions">
            <div className="rating-action">
              <button
                type="button"
                className="secondary-button"
                disabled={isSubmitting}
                onClick={() => void handleRate('hard')}
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
                onClick={() => void handleRate('easy')}
              >
                Easy
              </button>
              <span className="rating-caption">一次写对 −1</span>
            </div>
          </div>
        ) : null}

        {quizStatus === 'wrong' ? (
          <div className="actions">
            <button
              type="button"
              className="danger-button"
              disabled={isSubmitting}
              onClick={() => void handleRate('again')}
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
