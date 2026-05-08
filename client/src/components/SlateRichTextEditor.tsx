import { useCallback, useMemo, useState } from 'react'
import { Editor, Element as SlateElement, Node, Transforms, createEditor } from 'slate'
import { HistoryEditor, withHistory } from 'slate-history'
import { Editable, ReactEditor, Slate, useSlate, withReact } from 'slate-react'
import type { BaseEditor, Descendant } from 'slate'
import type { RenderElementProps, RenderLeafProps } from 'slate-react'

type CustomElement = { type: 'paragraph' | 'bulleted-list' | 'numbered-list' | 'list-item'; children: CustomText[] }
type CustomText = { text: string; bold?: boolean; italic?: boolean; underline?: boolean }

declare module 'slate' {
  interface CustomTypes {
    Editor: BaseEditor & ReactEditor & HistoryEditor
    Element: CustomElement
    Text: CustomText
  }
}

const EMPTY_VALUE: Descendant[] = [{ type: 'paragraph', children: [{ text: '' }] }]

export function parseStoredRichText(value: string): Descendant[] {
  if (!value.trim()) return EMPTY_VALUE
  try {
    const parsed = JSON.parse(value) as Descendant[]
    if (Array.isArray(parsed) && parsed.length > 0) return parsed
  } catch {}
  return [{ type: 'paragraph', children: [{ text: value.replace(/<[^>]+>/g, '') }] }]
}

export function serializeRichText(value: Descendant[]) {
  return JSON.stringify(value)
}

export function isSlateEmpty(value: Descendant[]) {
  const text = value.map((node) => Node.string(node)).join('').trim()
  return text.length === 0
}

function toggleMark(editor: Editor, mark: 'bold' | 'italic' | 'underline') {
  const marks = Editor.marks(editor)
  if (marks?.[mark]) {
    Editor.removeMark(editor, mark)
  } else {
    Editor.addMark(editor, mark, true)
  }
}

function toggleBlock(editor: Editor, format: CustomElement['type']) {
  const isList = format === 'bulleted-list' || format === 'numbered-list'
  Transforms.unwrapNodes(editor, {
    match: (n) =>
      !Editor.isEditor(n) &&
      SlateElement.isElement(n) &&
      (n.type === 'bulleted-list' || n.type === 'numbered-list'),
    split: true,
  })
  const type = isList ? 'list-item' : format
  Transforms.setNodes(editor, { type })
  if (isList) {
    const block: CustomElement = { type: format, children: [] as CustomText[] }
    Transforms.wrapNodes(editor, block)
  }
}

function ToolbarButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="ghost-button" onMouseDown={(event) => event.preventDefault()} onClick={onClick}>
      {label}
    </button>
  )
}

function Toolbar() {
  const editor = useSlate()
  return (
    <div className="slate-toolbar">
      <ToolbarButton label="B" onClick={() => toggleMark(editor, 'bold')} />
      <ToolbarButton label="I" onClick={() => toggleMark(editor, 'italic')} />
      <ToolbarButton label="U" onClick={() => toggleMark(editor, 'underline')} />
      <ToolbarButton label="• 列表" onClick={() => toggleBlock(editor, 'bulleted-list')} />
      <ToolbarButton label="1. 列表" onClick={() => toggleBlock(editor, 'numbered-list')} />
    </div>
  )
}

function renderElement(props: RenderElementProps) {
  const { attributes, children, element } = props
  switch (element.type) {
    case 'bulleted-list':
      return <ul {...attributes}>{children}</ul>
    case 'numbered-list':
      return <ol {...attributes}>{children}</ol>
    case 'list-item':
      return <li {...attributes}>{children}</li>
    default:
      return <p {...attributes}>{children}</p>
  }
}

function renderLeaf(props: RenderLeafProps) {
  const { attributes, children, leaf } = props
  let output = children
  if (leaf.bold) output = <strong>{output}</strong>
  if (leaf.italic) output = <em>{output}</em>
  if (leaf.underline) output = <u>{output}</u>
  return <span {...attributes}>{output}</span>
}

type Props = {
  value: Descendant[]
  onChange: (value: Descendant[]) => void
  readOnly?: boolean
  placeholder?: string
}

export function SlateRichTextEditor({ value, onChange, readOnly = false, placeholder = '请输入内容...' }: Props) {
  const editor = useMemo(() => withHistory(withReact(createEditor())), [])
  const [internalValue, setInternalValue] = useState<Descendant[]>(value)
  const renderElementFn = useCallback(renderElement, [])
  const renderLeafFn = useCallback(renderLeaf, [])

  return (
    <Slate
      editor={editor}
      initialValue={internalValue}
      onChange={(nextValue) => {
        setInternalValue(nextValue)
        onChange(nextValue)
      }}
    >
      {!readOnly ? <Toolbar /> : null}
      <div className={readOnly ? 'slate-readonly' : 'slate-editor-shell'}>
        <Editable
          readOnly={readOnly}
          renderElement={renderElementFn}
          renderLeaf={renderLeafFn}
          placeholder={placeholder}
          className={readOnly ? 'slate-content' : 'slate-content editable'}
        />
      </div>
    </Slate>
  )
}
