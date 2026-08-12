import { useRef, useState } from 'react'
import { Button, ProgressBar, TextArea } from '@heroui/react'
import { Sparkles, Trash2 } from 'lucide-react'

import { analyzeText, type AnalyzeTextResult } from '../api/analyze'
import { getErrorMessage } from '../api/error'
import { WordLookupCard } from '../components/WordLookupCard'
import { useWordLookup } from '../hooks/useWordLookup'
import { useI18n } from '../i18n'
import { tokenBase, type ColorMode } from '../lib/analyzeTokens'
import { AnalyzeResultCard, type TokenRef } from './analyze/AnalyzeResultCard'
import { WordDetailCard } from './analyze/WordDetailCard'
import { useWordDetail } from './analyze/useWordDetail'

/** 服务端的上限，写在这里只为了在输入框上给个字数提示。 */
const MAX_CHARS = 1000

/** 三个开关记在本地，下次进页面还是它们。 */
const PREFS_KEY = 'analyze-prefs'

type Prefs = {
  mode: ColorMode
  furigana: boolean
  translation: boolean
}

const DEFAULT_PREFS: Prefs = { mode: 'pos', furigana: true, translation: true }

function readPrefs(): Prefs {
  if (typeof window === 'undefined') return DEFAULT_PREFS
  try {
    const raw = window.localStorage.getItem(PREFS_KEY)
    if (!raw) return DEFAULT_PREFS
    const parsed = JSON.parse(raw) as Partial<Prefs>
    return {
      mode: parsed.mode === 'jlpt' ? 'jlpt' : 'pos',
      furigana: parsed.furigana !== false,
      translation: parsed.translation !== false,
    }
  } catch {
    return DEFAULT_PREFS
  }
}

/**
 * 文解析。
 *
 * 一段日文 → 逐词（假名 / 词性 / 辞書形）+ 整句中文翻译；点任意一个词，右侧
 * 给这个词**在这句话里**的 AI 语法详解，下面接一张和查词页同款的查词结果卡
 * （本地词库释义、AI 释义、加到词单），查的是这个词的辞書形。
 *
 * 页面在 keep-alive 里：解析结果和点开过的详解都是花过 token 的，去别的页面
 * 查个词再回来不该重来一遍。
 */
export function AnalyzePage() {
  const { t } = useI18n()
  const [text, setText] = useState('')
  const [result, setResult] = useState<AnalyzeTextResult | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<TokenRef | null>(null)
  const [prefs, setPrefs] = useState<Prefs>(readPrefs)
  const runRef = useRef(0)

  const detailStore = useWordDetail()

  const savePrefs = (patch: Partial<Prefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch }
      window.localStorage.setItem(PREFS_KEY, JSON.stringify(next))
      return next
    })
  }

  const sentences = result?.sentences ?? []
  const selectedSentence = selected ? sentences[selected.sentence] : undefined
  const selectedToken = selected ? selectedSentence?.tokens[selected.token] : undefined

  const handleAnalyze = async () => {
    const value = text.trim()
    if (!value) {
      setError(t('analyze.emptyInput'))
      return
    }
    // 取消令牌：两次解析赛跑时，晚回来的旧结果不能盖掉新的。
    const run = ++runRef.current
    setIsAnalyzing(true)
    setProgress(6)
    setError(null)
    setSelected(null)
    detailStore.clear()
    const timer = window.setInterval(() => {
      setProgress((current) => {
        if (current >= 90) return current
        const delta = current < 45 ? 5 : current < 75 ? 3 : 1
        return Math.min(90, current + delta)
      })
    }, 500)
    try {
      const analyzed = await analyzeText(value)
      if (run !== runRef.current) return
      setResult(analyzed)
      // 选中的是「第几句第几个词」，换了一份结果这组下标就指向别的词了 ——
      // 解析途中点过词的话，上面开头那次清空已经被它盖掉，这里再清一次。
      setSelected(null)
      detailStore.clear()
    } catch (analyzeError) {
      if (run !== runRef.current) return
      setError(getErrorMessage(analyzeError, t('analyze.failed')))
    } finally {
      window.clearInterval(timer)
      if (run === runRef.current) {
        setProgress(100)
        window.setTimeout(() => setProgress(0), 400)
        setIsAnalyzing(false)
      }
    }
  }

  const handleSelect = (ref: TokenRef) => {
    const sentence = sentences[ref.sentence]
    const token = sentence?.tokens[ref.token]
    if (!sentence || !token) return
    setSelected(ref)
    void detailStore.select(token, sentence.text)
  }

  // 下面那张查词卡查的是辞書形：AI 详解回来后以它给的为准（它看得到整句），
  // 还没回来就先用解析阶段的原形，点下去立刻有本地释义可看。
  const lookupTerm = selectedToken
    ? detailStore.detail?.word === selectedToken.word
      ? detailStore.detail.base
      : tokenBase(selectedToken)
    : ''
  const lookup = useWordLookup({
    term: lookupTerm,
    direction: 'ja-zh',
    // 传进来的已经是辞書形，服务端不必再校准一次。
    normalize: false,
  })

  return (
    <section className="page">
      <div className="section-header">
        <div>
          <h2>{t('analyze.title')}</h2>
          <p className="muted">{t('analyze.subtitle')}</p>
        </div>
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <div className="card grid gap-2.5">
            <TextArea
              aria-label={t('analyze.inputLabel')}
              value={text}
              maxLength={MAX_CHARS}
              rows={5}
              fullWidth
              placeholder={t('analyze.placeholder')}
              onChange={(event) => setText(event.target.value)}
              lang="ja"
            />
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="muted text-xs tabular-nums">
                {text.length} / {MAX_CHARS}
              </span>
              <div className="ml-auto flex items-center gap-2">
                {text ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    onPress={() => setText('')}
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                    {t('analyze.clear')}
                  </Button>
                ) : null}
                <Button
                  variant="primary"
                  type="button"
                  isPending={isAnalyzing}
                  onPress={() => void handleAnalyze()}
                >
                  <Sparkles className="size-3.5" aria-hidden />
                  {t('analyze.run')}
                </Button>
              </div>
            </div>
            {isAnalyzing || progress > 0 ? (
              <ProgressBar
                aria-label={t('analyze.running')}
                color={isAnalyzing ? 'accent' : 'success'}
                size="sm"
                value={progress}
              >
                <ProgressBar.Track>
                  <ProgressBar.Fill />
                </ProgressBar.Track>
              </ProgressBar>
            ) : null}
            {error ? <p className="error-text m-0">{error}</p> : null}
          </div>

          {sentences.length > 0 ? (
            <>
              {result && result.failedCount > 0 ? (
                <p className="muted m-0 text-[13px]">
                  {t('analyze.partialFailed', { count: result.failedCount })}
                </p>
              ) : null}
              <AnalyzeResultCard
                sentences={sentences}
                mode={prefs.mode}
                onModeChange={(mode) => savePrefs({ mode })}
                showFurigana={prefs.furigana}
                onShowFuriganaChange={(furigana) => savePrefs({ furigana })}
                showTranslation={prefs.translation}
                onShowTranslationChange={(translation) => savePrefs({ translation })}
                selected={selected}
                onSelect={handleSelect}
              />
            </>
          ) : null}
        </div>

        {/* 右列：AI 详解 + 查词结果。两张卡在同一列里，左右边自然对齐。
            宽屏钉住不动，点词时不必来回滚；比视口高时这一列自己滚。 */}
        <div className="flex min-w-0 flex-col gap-4 xl:sticky xl:top-0 xl:max-h-[calc(100dvh-8rem)] xl:overflow-y-auto xl:overscroll-contain">
          <WordDetailCard
            token={selectedToken ?? null}
            sentence={selectedSentence?.text ?? ''}
            store={detailStore}
          />
          {lookupTerm ? <WordLookupCard lookup={lookup} /> : null}
        </div>
      </div>
    </section>
  )
}
