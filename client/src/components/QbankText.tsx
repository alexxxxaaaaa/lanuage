import { Fragment, type ReactNode } from 'react'

/**
 * 题库正文的极简渲染器。源数据只用到两种标记，不值得为它引一个 markdown 库：
 *   **强调**            → 卷面上的下划线/加粗（考点词）
 *   ![](https://…)      → 情報検索（問題13）的图片型材料
 * 其余一律按纯文本走，换行靠 CSS 的 white-space: pre-wrap 保留。
 */

const IMAGE_RE = /!\[[^\]]*\]\((\S+?)\)/g
const EMPHASIS_RE = /\*\*([^*]+)\*\*/g

function renderEmphasis(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let last = 0
  for (const m of text.matchAll(EMPHASIS_RE)) {
    const at = m.index ?? 0
    if (at > last) nodes.push(text.slice(last, at))
    nodes.push(
      <em className="qbank-em" key={`${keyPrefix}-em-${at}`}>
        {m[1]}
      </em>,
    )
    last = at + m[0].length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

export function QbankText({ text, className }: { text: string; className?: string }) {
  const parts: ReactNode[] = []
  let last = 0
  for (const m of text.matchAll(IMAGE_RE)) {
    const at = m.index ?? 0
    if (at > last) {
      parts.push(
        <Fragment key={`t-${last}`}>{renderEmphasis(text.slice(last, at), `t-${last}`)}</Fragment>,
      )
    }
    parts.push(<img className="qbank-figure" key={`img-${at}`} src={m[1]} alt="" loading="lazy" />)
    last = at + m[0].length
  }
  if (last < text.length) {
    parts.push(
      <Fragment key={`t-${last}`}>{renderEmphasis(text.slice(last), `t-${last}`)}</Fragment>,
    )
  }
  return <div className={className}>{parts}</div>
}
