import { Switch } from '@heroui/react'
import { Lightbulb } from 'lucide-react'

import type { AnalyzeSentence, AnalyzeToken } from '../../api/analyze'
import { SelectField } from '../../components/ui/SelectField'
import { useI18n } from '../../i18n'
import {
  JLPT_COLOR,
  JLPT_LEGEND,
  POS_COLOR,
  POS_GROUPS,
  getPosGroup,
  hasKanji,
  isPunctuation,
  tokenBase,
  type ColorMode,
} from '../../lib/analyzeTokens'
import { JLPT_LEVELS, useJlptLevels, type JlptLevel } from '../../lib/jlptVocab'

export type TokenRef = { sentence: number; token: number }

type Props = {
  sentences: AnalyzeSentence[]
  mode: ColorMode
  onModeChange: (mode: ColorMode) => void
  showFurigana: boolean
  onShowFuriganaChange: (value: boolean) => void
  showTranslation: boolean
  onShowTranslationChange: (value: boolean) => void
  selected: TokenRef | null
  onSelect: (ref: TokenRef) => void
}

/**
 * 一个词挂几个级别时（東 = ひがし N5 / あずま N1）下划线只能画一种颜色，取
 * **最简单**的那一档：词表收了它到 N5，就说明 N5 的学习者已经该认得这个词形，
 * 按 N1 涂红只会让满屏都是警报。级别标签那边仍旧几个并排显示，不替谁挑一个。
 */
function easiestLevel(levels: readonly JlptLevel[]): JlptLevel | 'none' {
  for (let i = JLPT_LEVELS.length - 1; i >= 0; i -= 1) {
    if (levels.includes(JLPT_LEVELS[i])) return JLPT_LEVELS[i]
  }
  return 'none'
}

export function AnalyzeResultCard({
  sentences,
  mode,
  onModeChange,
  showFurigana,
  onShowFuriganaChange,
  showTranslation,
  onShowTranslationChange,
  selected,
  onSelect,
}: Props) {
  const { t } = useI18n()
  // JLPT 那张表只在切到级别模式时才下载（8.8 千行 / 95 KB）。
  const getLevels = useJlptLevels(mode === 'jlpt')

  const colorOf = (token: AnalyzeToken) =>
    mode === 'pos'
      ? POS_COLOR[getPosGroup(token.pos)]
      : JLPT_COLOR[easiestLevel(getLevels(tokenBase(token)))]

  return (
    <article className="card grid gap-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5">
        <h3 className="m-0 text-base font-semibold text-foreground">
          {t('analyze.resultTitle')}
        </h3>
        <SelectField
          aria-label={t('analyze.modeLabel')}
          value={mode}
          onChange={onModeChange}
          className="min-w-[150px]"
          options={[
            { value: 'pos' as ColorMode, label: t('analyze.modePos') },
            { value: 'jlpt' as ColorMode, label: t('analyze.modeJlpt') },
          ]}
        />
        <div className="ml-auto flex flex-wrap items-center gap-x-5 gap-y-2">
          <Switch size="sm" isSelected={showFurigana} onChange={onShowFuriganaChange}>
            <Switch.Content>
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
              <span className="text-[13px] text-muted">{t('analyze.showFurigana')}</span>
            </Switch.Content>
          </Switch>
          <Switch
            size="sm"
            isSelected={showTranslation}
            onChange={onShowTranslationChange}
          >
            <Switch.Content>
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
              <span className="text-[13px] text-muted">
                {t('analyze.showTranslation')}
              </span>
            </Switch.Content>
          </Switch>
        </div>
      </div>

      <div className="grid gap-4" lang="ja">
        {sentences.map((sentence, sentenceIndex) => (
          <div key={sentenceIndex} className="grid gap-1.5">
            <div className="flex flex-wrap items-end gap-y-1.5 text-[19px]">
              {sentence.tokens.map((token, tokenIndex) => {
                // 标点、空白：不是词，不着色也点不开 —— 点开只会白烧一次 token。
                if (isPunctuation(token)) {
                  return (
                    <span
                      key={tokenIndex}
                      className="self-end pb-[7px] leading-snug whitespace-pre text-foreground"
                    >
                      {token.word}
                    </span>
                  )
                }
                const active =
                  selected?.sentence === sentenceIndex && selected.token === tokenIndex
                // 没有假名的词也占住这一行的高度（放一个不换行空格），一行里所有
                // 词的词身才对得齐，不然带汉字的词会把整行顶高一截。
                const furigana =
                  token.kana && hasKanji(token.word) ? token.kana : ' '
                return (
                  <button
                    key={tokenIndex}
                    type="button"
                    onClick={() => onSelect({ sentence: sentenceIndex, token: tokenIndex })}
                    className={`flex cursor-pointer flex-col items-center rounded-md px-0.5 pt-0.5 transition-colors hover:bg-accent/10 ${
                      active ? 'bg-accent/12' : ''
                    }`}
                  >
                    {showFurigana ? (
                      <span className="h-[1.15em] text-[0.6em] leading-none text-muted">
                        {furigana}
                      </span>
                    ) : null}
                    <span className="leading-snug text-foreground">{token.word}</span>
                    <span
                      className={`mt-0.5 h-[3px] w-full rounded-full ${colorOf(token)}`}
                    />
                  </button>
                )
              })}
            </div>
            {showTranslation && sentence.zh ? (
              <p
                className="m-0 border-l-2 border-accent/30 pl-2.5 text-[14px]/[1.7] text-muted"
                lang="zh"
              >
                {sentence.zh}
              </p>
            ) : null}
          </div>
        ))}
      </div>

      <div className="grid gap-2 border-t border-border pt-3">
        <p className="muted m-0 flex items-center gap-1.5 text-[13px]">
          <Lightbulb className="size-3.5 shrink-0 text-accent" aria-hidden />
          {t('analyze.clickHint')}
        </p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px] text-muted">
          {mode === 'pos'
            ? POS_GROUPS.map((group) => (
                <span key={group} className="inline-flex items-center gap-1.5">
                  <span className={`h-[3px] w-4 rounded-full ${POS_COLOR[group]}`} />
                  {t(`analyze.pos.${group}`)}
                </span>
              ))
            : JLPT_LEGEND.map((level) => (
                <span key={level} className="inline-flex items-center gap-1.5">
                  <span className={`h-[3px] w-4 rounded-full ${JLPT_COLOR[level]}`} />
                  {level === 'none' ? t('analyze.levelOther') : level}
                </span>
              ))}
        </div>
      </div>
    </article>
  )
}
