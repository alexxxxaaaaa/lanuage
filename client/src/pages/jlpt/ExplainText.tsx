import { Fragment, useMemo } from 'react'

import { QbankText } from '../../components/QbankText'
import { groupBlocks, parseExplain, type MarkBlock } from './explainFormat'

/**
 * 解析 / 译文的排版。切分规则和它要救的那件事写在 explainFormat.ts 里，
 * 这里只管把切出来的块摆好。
 */

/**
 * 一组标记有多宽，决定它怎么排。按组里最长的那个算，同组的观感才一致。
 *
 *   ≤4 字   「男」「女」「質問1」    共用一个网格并排，左列宽度自适应、条条对齐，
 *                                  读起来像剧本，手机上也不挤
 *   ≤16 字  「1.ざらざら」这类词条   窄屏两列会把释义挤成一条缝，所以窄屏堆叠、
 *                                  宽屏才并排（左列定宽，不必共用网格就能齐）
 *   更长    整句的选项判定          左列放不下，一律堆叠：选项独占一行，判定另起
 */
const INLINE_UPTO = 4
const TWO_COL_UPTO = 16

function widthOf(items: MarkBlock[]) {
  return Math.max(...items.map((b) => b.label.length))
}

/** 说话人那种短标记：次要信息，弱化成小字，让台词是主角。 */
const DT_INLINE = 'min-w-0 text-[13px] font-semibold text-muted [overflow-wrap:anywhere]'
/** 词条 / 选项原文：它本身就是要看的东西，不弱化。 */
const DT_BLOCK = 'min-w-0 font-semibold text-foreground [overflow-wrap:anywhere]'

export function ExplainText({ text, className }: { text: string; className?: string }) {
  const groups = useMemo(() => groupBlocks(parseExplain(text)), [text])

  return (
    <div className={`grid gap-2.5 ${className ?? ''}`}>
      {groups.map((group, gi) => {
        if (group.kind === 'marks') {
          const width = widthOf(group.items)
          if (width <= INLINE_UPTO) {
            return (
              <dl
                className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5"
                key={gi}
              >
                {group.items.map((b, i) => (
                  <Fragment key={i}>
                    <dt className={DT_INLINE}>{b.label}</dt>
                    <dd className="multiline-text m-0 min-w-0">
                      <QbankText text={b.text} />
                    </dd>
                  </Fragment>
                ))}
              </dl>
            )
          }
          // 每条自成一格：窄屏堆叠时条目之间才有独立的间距，不会和标记/正文的行距混在一起。
          return (
            <dl className="m-0 grid gap-2" key={gi}>
              {group.items.map((b, i) => (
                <div
                  className={`grid gap-x-3 gap-y-0.5 ${
                    width <= TWO_COL_UPTO
                      ? 'sm:grid-cols-[minmax(0,14em)_minmax(0,1fr)]'
                      : ''
                  }`}
                  key={i}
                >
                  <dt className={DT_BLOCK}>{b.label}</dt>
                  <dd className="multiline-text m-0 min-w-0">
                    <QbankText text={b.text} />
                  </dd>
                </div>
              ))}
            </dl>
          )
        }

        if (group.block.kind === 'section') {
          return (
            <div className="grid gap-1" key={gi}>
              <p className="m-0 inline-flex w-fit rounded-md bg-foreground/6 px-1.5 py-0.5 text-xs font-semibold whitespace-normal text-muted">
                {group.block.label}
              </p>
              {group.block.text ? (
                <QbankText className="multiline-text" text={group.block.text} />
              ) : null}
            </div>
          )
        }

        return <QbankText className="multiline-text" key={gi} text={group.block.text} />
      })}
    </div>
  )
}
