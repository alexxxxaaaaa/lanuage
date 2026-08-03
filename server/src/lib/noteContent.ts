/**
 * 笔记正文的纯文本视图。
 *
 * `Note.content` 历史上换过三种格式：现在是 BlockNote 的 `Block[]` JSON，之前是
 * Tiptap 存的 HTML，最早是 Slate 的 JSON。老行不做批量转换（HTML → block 要
 * 浏览器 DOM，服务端没有），而是等用户下次编辑时由前端改写，所以这三种会长期
 * 共存 —— 凡是要「读文字」的地方（列表摘要、搜索）都得走这里。
 */

/** 递归收集任意 JSON 里的 `text` 字段，Slate 和 BlockNote 的行内节点都是这个键。 */
function collectText(node: unknown, out: string[]): void {
  if (Array.isArray(node)) {
    for (const item of node) collectText(item, out)
    return
  }
  if (!node || typeof node !== 'object') return

  const record = node as Record<string, unknown>
  if (typeof record.text === 'string') out.push(record.text)
  for (const value of Object.values(record)) {
    if (value && typeof value === 'object') collectText(value, out)
  }
}

function jsonToText(parsed: unknown): string {
  // 顶层每个块占一行，块内（含 children、表格单元格）拼成一段。
  const blocks = Array.isArray(parsed) ? parsed : [parsed]
  return blocks
    .map((block) => {
      const parts: string[] = []
      collectText(block, parts)
      return parts.join('')
    })
    .filter((line) => line !== '')
    .join('\n')
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      const code = Number.parseInt(entity.slice(2), 16)
      return Number.isNaN(code) ? match : String.fromCodePoint(code)
    }
    if (entity.startsWith('#')) {
      const code = Number.parseInt(entity.slice(1), 10)
      return Number.isNaN(code) ? match : String.fromCodePoint(code)
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match
  })
}

function htmlToText(html: string): string {
  return decodeEntities(
    html
      // 块级收尾标签变成换行，否则相邻两段会黏成一个词。
      .replace(/<\/(p|div|li|h[1-6]|blockquote|pre|tr)\s*>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]*>/g, ''),
  )
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .join('\n')
}

/** 正文的完整纯文本。格式认不出来时按纯文本原样返回。 */
export function noteContentToText(content: string): string {
  const trimmed = (content ?? '').trim()
  if (!trimmed) return ''

  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      return jsonToText(JSON.parse(trimmed))
    } catch {
      // 落到下面按 HTML / 纯文本处理。
    }
  }
  if (trimmed.startsWith('<')) return htmlToText(trimmed)
  return trimmed
}

/** 列表用的一行摘要。 */
export function noteContentToPreview(content: string, maxLength: number): string {
  const text = noteContentToText(content).replace(/\s+/g, ' ').trim()
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text
}
