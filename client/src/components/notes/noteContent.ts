import type { PartialBlock } from '@blocknote/core'

/**
 * 读老笔记。
 *
 * `Note.content` 前后换过三种格式：现在是 BlockNote 的 `Block[]` JSON，之前是
 * Tiptap 存的 HTML，最早是 Slate 的 JSON。服务端没有 DOM，转不了 HTML → block，
 * 所以不做批量迁移 —— 打开一篇老笔记时在这里认出格式，转成 block 灌进编辑器，
 * 等用户真的动了笔才按新格式写回去。只看不改的笔记会一直是老格式，这没关系。
 */
export type StoredContent =
  /** 已经是 BlockNote 文档，可以直接当 initialContent。 */
  | { kind: 'blocks'; blocks: PartialBlock[] }
  /** 老格式，需要 `editor.tryParseHTMLToBlocks` 异步转一道。 */
  | { kind: 'html'; html: string }
  | { kind: 'empty' }

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null
}

/**
 * Slate 的节点是 `{ type, children: [{ text }] }`，BlockNote 的块是
 * `{ id, type, props, content }`，两边都可能有 `children`，靠「children 里直接
 * 挂着文本」把 Slate 认出来。
 */
function isSlateNode(node: unknown): boolean {
  if (!isRecord(node)) return false
  const children = node.children
  return (
    Array.isArray(children) &&
    children.some((child) => isRecord(child) && typeof child.text === 'string')
  )
}

function escapeHtml(text: string) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function slateToHtml(nodes: unknown[]): string {
  return nodes
    .map((node) => {
      if (!isRecord(node)) return ''
      const children = Array.isArray(node.children) ? node.children : []
      const text = children
        .map((child) => (isRecord(child) && typeof child.text === 'string' ? child.text : ''))
        .join('')
      const safe = escapeHtml(text)
      switch (node.type) {
        case 'list-item':
          return `<li>${safe || '&nbsp;'}</li>`
        case 'bulleted-list':
          return `<ul>${safe}</ul>`
        case 'numbered-list':
          return `<ol>${safe}</ol>`
        default:
          return `<p>${safe || '<br>'}</p>`
      }
    })
    .join('')
}

function plainTextToHtml(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => `<p>${escapeHtml(line) || '<br>'}</p>`)
    .join('')
}

export function readStoredContent(raw: string): StoredContent {
  const trimmed = (raw ?? '').trim()
  if (!trimmed) return { kind: 'empty' }

  if (trimmed.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(trimmed)
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.some(isSlateNode)
          ? { kind: 'html', html: slateToHtml(parsed) }
          : { kind: 'blocks', blocks: parsed as PartialBlock[] }
      }
      return { kind: 'empty' }
    } catch {
      // JSON 坏了就当纯文本，至少别把内容弄丢。
      return { kind: 'html', html: plainTextToHtml(trimmed) }
    }
  }

  if (trimmed.startsWith('<')) return { kind: 'html', html: trimmed }
  return { kind: 'html', html: plainTextToHtml(trimmed) }
}
