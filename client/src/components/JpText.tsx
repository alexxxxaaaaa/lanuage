import type { ReactNode } from 'react'
import { BOLD_SPLIT_RE, RUBY_RE } from '../utils/grammarText'

/**
 * 渲染一段可能带注音和高亮的日文（蓝宝书条目的原始写法，见 utils/grammarText）。
 *
 * 这里不走 dangerouslySetInnerHTML：内容虽然是自己导入的，但同一个渲染路径也
 * 会用在用户手写的条目上。改成自己切词、拼 React 节点，顺带能给高亮上主题色。
 */
function renderRuby(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = new RegExp(RUBY_RE.source, 'g')
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index))
    out.push(
      <ruby key={`${keyPrefix}-${m.index}`}>
        {m[1]}
        <rt>{m[2]}</rt>
      </ruby>,
    )
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export function JpText({
  text,
  className = '',
}: {
  text: string
  className?: string
}) {
  if (!text) return null

  const nodes: ReactNode[] = []
  let bold = false
  for (const [i, part] of text.split(BOLD_SPLIT_RE).entries()) {
    if (!part) continue
    if (/^<b>$/i.test(part)) {
      bold = true
      continue
    }
    if (/^<\/b>$/i.test(part)) {
      bold = false
      continue
    }
    const inner = renderRuby(part, String(i))
    nodes.push(
      bold ? (
        <strong key={i} className="font-semibold text-accent">
          {inner}
        </strong>
      ) : (
        <span key={i}>{inner}</span>
      ),
    )
  }
  return <span className={`furigana-text ${className}`.trim()}>{nodes}</span>
}
