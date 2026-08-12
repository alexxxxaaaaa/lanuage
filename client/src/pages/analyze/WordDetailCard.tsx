import { Fragment, type ReactNode } from 'react'
import { Button, Chip, Skeleton } from '@heroui/react'
import { BookOpen, RotateCcw } from 'lucide-react'

import type { AnalyzeToken } from '../../api/analyze'
import { useI18n } from '../../i18n'
import { tokenBase } from '../../lib/analyzeTokens'
import type { WordDetailStore } from './useWordDetail'

/**
 * AI 把术语和词形用【】括起来（prompt 里要求的）。这里把括号吃掉、内容标成
 * 主题色 —— 满屏的【】比高亮本身还抢眼。「」是日文原文的引号，原样留着。
 */
const HIGHLIGHT = /(【[^】]+】)/g

function renderLine(line: string, keyPrefix: string): ReactNode[] {
  return line.split(HIGHLIGHT).map((part, index) => {
    if (!part) return null
    const key = `${keyPrefix}-${index}`
    return part.startsWith('【') && part.endsWith('】') ? (
      <strong key={key} className="font-semibold text-accent">
        {part.slice(1, -1)}
      </strong>
    ) : (
      <Fragment key={key}>{part}</Fragment>
    )
  })
}

function Explanation({ text }: { text: string }) {
  return (
    <p className="m-0 text-[14px]/[1.8] text-foreground">
      {text.split('\n').map((line, index, lines) => (
        <Fragment key={index}>
          {renderLine(line, String(index))}
          {index < lines.length - 1 ? <br /> : null}
        </Fragment>
      ))}
    </p>
  )
}

export function WordDetailCard({
  token,
  sentence,
  store,
}: {
  /** 当前点中的词。null = 还没点过。 */
  token: AnalyzeToken | null
  /** 这个词所在的整句 —— 详解就是按它给的。 */
  sentence: string
  store: WordDetailStore
}) {
  const { t } = useI18n()

  if (!token) {
    return (
      <article className="card grid justify-items-center gap-3 py-10 text-center">
        <span className="grid size-12 place-items-center rounded-full bg-accent/10 text-accent">
          <BookOpen className="size-5" aria-hidden />
        </span>
        <p className="muted m-0 text-[13px]/[1.8]">
          {t('analyze.detailEmptyTitle')}
          <br />
          <span className="text-xs">{t('analyze.detailEmptyHint')}</span>
        </p>
      </article>
    )
  }

  const { detail, error, isLoading } = store
  // 详解回来之前先用解析阶段给的读音/辞書形撑住标题，点下去就有东西看。
  const kana = detail?.kana || token.kana
  const base = detail?.base || tokenBase(token)
  const pos = detail?.pos || token.pos

  return (
    <article className="card grid gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-baseline gap-2.5">
          <h3 className="m-0 text-2xl/tight font-bold text-foreground" lang="ja">
            {token.word}
          </h3>
          {kana ? (
            <span className="muted text-sm" lang="ja">
              {kana}
            </span>
          ) : null}
        </div>
        <Button
          variant="secondary"
          size="sm"
          type="button"
          isPending={isLoading}
          onPress={() => void store.select(token, sentence, true)}
        >
          <RotateCcw className="size-3.5" aria-hidden />
          {t('wordSearch.regenerate')}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {pos ? (
          <Chip size="sm" variant="soft">
            <Chip.Label>{pos}</Chip.Label>
          </Chip>
        ) : null}
        {base !== token.word ? (
          <Chip size="sm" variant="soft" color="accent">
            <Chip.Label>
              {t('analyze.baseForm')} {base}
            </Chip.Label>
          </Chip>
        ) : null}
      </div>

      {error ? <p className="error-text m-0">{error}</p> : null}

      {isLoading && !detail ? (
        <div className="grid gap-2 py-1">
          <Skeleton className="h-4 w-2/5 rounded-lg" />
          <Skeleton className="h-3 w-full rounded-lg" />
          <Skeleton className="h-3 w-4/5 rounded-lg" />
          <Skeleton className="h-3 w-3/5 rounded-lg" />
        </div>
      ) : null}

      {detail?.meaning ? (
        <p className="m-0 text-[15px]/[1.7] font-medium text-foreground">
          {detail.meaning}
        </p>
      ) : null}

      {detail?.explanation ? (
        <div className="grid gap-1 rounded-xl border border-border bg-foreground/2 px-3.5 py-3">
          <span className="text-xs font-bold tracking-[0.06em] text-muted uppercase">
            {t('analyze.explanation')}
          </span>
          <Explanation text={detail.explanation} />
        </div>
      ) : null}
    </article>
  )
}
