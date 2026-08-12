import { BlockNoteEditor } from '@blocknote/core'

import type { ChatMessage } from '../../store/useAiChat'

/**
 * 一段对话 → 一篇笔记的正文（BlockNote 的 `Block[]` JSON，和 noteContent.ts
 * 读的是同一种格式）。
 *
 * 提问变引用块，回答按 Markdown 原样解析 —— 助教被要求只用段落、列表、加粗和
 * 行内代码（见 server/src/services/aiChatService.ts），这几种 BlockNote 都认，
 * 所以笔记里的排版和聊天气泡里的是同一份，不是各写一遍。
 */

/** 只借它的 Markdown 解析，不挂到任何 DOM 上，所以整站共用一个实例就够。 */
let parser: BlockNoteEditor | null = null

function getParser() {
  parser ??= BlockNoteEditor.create()
  return parser
}

/** 多行提问整段引用：连续的 `> ` 行会被解析成同一个引用块。 */
function toQuote(text: string) {
  return text
    .trim()
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join('\n')
}

export function chatToNoteContent(messages: ChatMessage[]): string {
  const markdown = messages
    .map((message) =>
      message.role === 'user' ? toQuote(message.content) : message.content.trim(),
    )
    .filter(Boolean)
    .join('\n\n')

  try {
    const blocks = getParser().tryParseMarkdownToBlocks(markdown)
    if (blocks.length > 0) return JSON.stringify(blocks)
  } catch {
    // 落到下面的兜底
  }
  // 解析不出来也要把话留住：整段当纯文本存，readStoredContent 认得出来。
  return markdown
}
