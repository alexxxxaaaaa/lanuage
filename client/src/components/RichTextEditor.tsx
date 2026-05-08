import { useEffect } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Link from '@tiptap/extension-link'
import type { Editor } from '@tiptap/react'

type Props = {
  value: string
  onChange?: (html: string) => void
  readOnly?: boolean
  placeholder?: string
  minHeight?: number
}

/**
 * Convert legacy Slate JSON content to HTML for the new Tiptap editor.
 * Old notes were stored as serialized Slate Descendant arrays.
 */
function legacySlateToHtml(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed.startsWith('[') && !trimmed.startsWith('{')) return null
  try {
    const parsed = JSON.parse(trimmed) as Array<{
      type?: string
      children?: Array<{ text?: string }>
    }>
    if (!Array.isArray(parsed)) return null
    const html = parsed
      .map((node) => {
        const text = (node.children ?? []).map((c) => c.text ?? '').join('')
        const safe = escapeHtml(text)
        if (node.type === 'list-item') return `<li>${safe || '&nbsp;'}</li>`
        if (node.type === 'bulleted-list') return `<ul>${safe}</ul>`
        if (node.type === 'numbered-list') return `<ol>${safe}</ol>`
        return `<p>${safe || '<br>'}</p>`
      })
      .join('')
    return html || '<p></p>'
  } catch {
    return null
  }
}

function escapeHtml(text: string) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function plainTextToHtml(text: string) {
  if (!text) return '<p></p>'
  return text
    .split(/\r?\n/)
    .map((line) => `<p>${escapeHtml(line) || '<br>'}</p>`)
    .join('')
}

export function normalizeNoteContentForEditor(value: string): string {
  if (!value) return '<p></p>'
  const fromSlate = legacySlateToHtml(value)
  if (fromSlate !== null) return fromSlate
  if (/^\s*</.test(value)) return value
  return plainTextToHtml(value)
}

function ToolbarButton({
  isActive,
  onClick,
  children,
  title,
}: {
  isActive?: boolean
  onClick: () => void
  children: React.ReactNode
  title?: string
}) {
  return (
    <button
      type="button"
      className={`rte-tool ${isActive ? 'is-active' : ''}`}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      title={title}
    >
      {children}
    </button>
  )
}

function Toolbar({ editor }: { editor: Editor }) {
  return (
    <div className="rte-toolbar">
      <ToolbarButton
        title="加粗 (Ctrl+B)"
        isActive={editor.isActive('bold')}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <strong>B</strong>
      </ToolbarButton>
      <ToolbarButton
        title="斜体 (Ctrl+I)"
        isActive={editor.isActive('italic')}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <em>I</em>
      </ToolbarButton>
      <ToolbarButton
        title="删除线"
        isActive={editor.isActive('strike')}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        <s>S</s>
      </ToolbarButton>
      <ToolbarButton
        title="行内代码"
        isActive={editor.isActive('code')}
        onClick={() => editor.chain().focus().toggleCode().run()}
      >
        {'<>'}
      </ToolbarButton>
      <span className="rte-divider" aria-hidden />
      <ToolbarButton
        title="标题 1"
        isActive={editor.isActive('heading', { level: 1 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
      >
        H1
      </ToolbarButton>
      <ToolbarButton
        title="标题 2"
        isActive={editor.isActive('heading', { level: 2 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        H2
      </ToolbarButton>
      <ToolbarButton
        title="标题 3"
        isActive={editor.isActive('heading', { level: 3 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
      >
        H3
      </ToolbarButton>
      <span className="rte-divider" aria-hidden />
      <ToolbarButton
        title="无序列表"
        isActive={editor.isActive('bulletList')}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        •
      </ToolbarButton>
      <ToolbarButton
        title="有序列表"
        isActive={editor.isActive('orderedList')}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        1.
      </ToolbarButton>
      <ToolbarButton
        title="任务列表（用 [ ]） "
        isActive={editor.isActive('blockquote')}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      >
        “”
      </ToolbarButton>
      <ToolbarButton
        title="代码块"
        isActive={editor.isActive('codeBlock')}
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
      >
        {`{ }`}
      </ToolbarButton>
      <ToolbarButton
        title="分隔线"
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
      >
        ―
      </ToolbarButton>
      <span className="rte-divider" aria-hidden />
      <ToolbarButton
        title="插入链接"
        isActive={editor.isActive('link')}
        onClick={() => {
          const previous = editor.getAttributes('link').href as string | undefined
          const url = window.prompt('链接地址', previous ?? 'https://')
          if (url === null) return
          if (url === '') {
            editor.chain().focus().extendMarkRange('link').unsetLink().run()
            return
          }
          editor
            .chain()
            .focus()
            .extendMarkRange('link')
            .setLink({ href: url })
            .run()
        }}
      >
        🔗
      </ToolbarButton>
      <span className="rte-divider" aria-hidden />
      <ToolbarButton
        title="撤销 (Ctrl+Z)"
        onClick={() => editor.chain().focus().undo().run()}
      >
        ↶
      </ToolbarButton>
      <ToolbarButton
        title="重做 (Ctrl+Shift+Z)"
        onClick={() => editor.chain().focus().redo().run()}
      >
        ↷
      </ToolbarButton>
    </div>
  )
}

export function RichTextEditor({
  value,
  onChange,
  readOnly = false,
  placeholder = '开始记录笔记...',
  minHeight = 220,
}: Props) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Placeholder.configure({ placeholder }),
      Link.configure({
        openOnClick: readOnly,
        autolink: true,
        HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
      }),
    ],
    content: normalizeNoteContentForEditor(value),
    editable: !readOnly,
    onUpdate: ({ editor: e }) => {
      onChange?.(e.getHTML())
    },
  })

  // Keep editor in sync if external value changes (e.g. switching notes).
  useEffect(() => {
    if (!editor) return
    const next = normalizeNoteContentForEditor(value)
    if (editor.getHTML() === next) return
    editor.commands.setContent(next, { emitUpdate: false })
  }, [value, editor])

  // Toggle editable flag if readOnly prop changes.
  useEffect(() => {
    if (!editor) return
    editor.setEditable(!readOnly)
  }, [readOnly, editor])

  if (!editor) return null

  return (
    <div className={`rte-shell ${readOnly ? 'is-readonly' : ''}`}>
      {!readOnly ? <Toolbar editor={editor} /> : null}
      <div className="rte-content-wrap" style={{ minHeight }}>
        <EditorContent editor={editor} className="rte-content" />
      </div>
    </div>
  )
}
