import { Fragment, useMemo, type ReactNode } from 'react'

/**
 * 聊天气泡里的排版。
 *
 * 认的记法正好是 system prompt 里允许助教用的那几种（段落、有序 / 无序列表、
 * **加粗**、`行内代码`，见 server/src/services/aiChatService.ts），所以这里
 * 不是一个通用 Markdown 渲染器，也不该长成那样：`#` 标题、表格、代码块既不会
 * 出现，出现了也只是模型没听话，退化成普通文字即可。
 *
 * 同一段文字「生成笔记」时交给 BlockNote 解析（见 chatToNote.ts），它认的是
 * 同一批记法 —— 聊天里看到的排版和笔记里的是同一份。
 */

type Block =
  | { kind: 'paragraph'; lines: string[] }
  | { kind: 'list'; ordered: boolean; items: string[] }

const BULLET_ITEM = /^\s*[-*+]\s+(.*)$/
const ORDERED_ITEM = /^\s*\d+[.)]\s+(.*)$/
/** 模型偶尔还是会甩个标题出来 —— 去掉井号，当加粗的一行处理。 */
const HEADING = /^\s*#{1,6}\s+(.*)$/
/** 加粗和行内代码。捕获组保留分隔符，配合 split 一次切出文字和标记两种片段。 */
const INLINE_MARK = /(\*\*[^*\n]+\*\*|`[^`\n]+`)/g

function parseChatMarkdown(text: string): Block[] {
  const blocks: Block[] = []

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trimEnd()
    const last = blocks[blocks.length - 1]

    if (!line.trim()) {
      // 空行只断块，不产生空段落。
      if (last) blocks.push({ kind: 'paragraph', lines: [] })
      continue
    }

    const bullet = BULLET_ITEM.exec(line)
    const ordered = bullet ? null : ORDERED_ITEM.exec(line)
    if (bullet || ordered) {
      const item = (bullet?.[1] ?? ordered?.[1] ?? '').trim()
      const isOrdered = ordered !== null
      if (last?.kind === 'list' && last.ordered === isOrdered) last.items.push(item)
      else blocks.push({ kind: 'list', ordered: isOrdered, items: [item] })
      continue
    }

    // 列表项的续行（缩进，且上一块正是列表）并进那一项。否则列表会被从中间
    // 截断，后面的项还会另起一个 <ol>，序号从 1 重来一遍。
    if (last?.kind === 'list' && /^\s{2,}/.test(rawLine)) {
      last.items[last.items.length - 1] += `\n${line.trim()}`
      continue
    }

    const heading = HEADING.exec(line)
    const content = heading ? `**${heading[1].trim()}**` : line
    // 段落内的单个换行照原样留着：例句和它的译文常常就是紧挨着的两行。
    if (last?.kind === 'paragraph' && last.lines.length > 0) last.lines.push(content)
    else blocks.push({ kind: 'paragraph', lines: [content] })
  }

  return blocks.filter((block) => block.kind !== 'paragraph' || block.lines.length > 0)
}

function renderInline(text: string): ReactNode[] {
  return text.split(INLINE_MARK).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong className="font-semibold text-foreground" key={index}>
          {part.slice(2, -2)}
        </strong>
      )
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code className="rounded bg-foreground/6 px-1 py-px text-[0.92em]" key={index}>
          {part.slice(1, -1)}
        </code>
      )
    }
    return <Fragment key={index}>{part}</Fragment>
  })
}

export function ChatMarkdown({ text, className }: { text: string; className?: string }) {
  const blocks = useMemo(() => parseChatMarkdown(text), [text])

  return (
    <div className={`grid gap-2.5 ${className ?? ''}`}>
      {blocks.map((block, index) => {
        if (block.kind === 'list') {
          const List = block.ordered ? 'ol' : 'ul'
          return (
            <List className="m-0 grid gap-1.5 pl-5" key={index}>
              {block.items.map((item, itemIndex) => (
                <li className="multiline-text" key={itemIndex}>
                  {renderInline(item)}
                </li>
              ))}
            </List>
          )
        }
        return (
          <p className="multiline-text m-0" key={index}>
            {renderInline(block.lines.join('\n'))}
          </p>
        )
      })}
    </div>
  )
}
