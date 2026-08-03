import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import { BlockNoteView } from '@blocknote/ariakit'
import { useCreateBlockNote } from '@blocknote/react'
import * as blockNoteLocales from '@blocknote/core/locales'

import { readStoredContent } from './noteContent'
import { useI18n, type UiLanguage } from '../../i18n'
import { useTheme } from '../../providers/themeContext'

const BLOCKNOTE_LOCALES: Record<UiLanguage, (typeof blockNoteLocales)['en']> = {
  zh: blockNoteLocales.zh,
  en: blockNoteLocales.en,
  jp: blockNoteLocales.ja,
}

export type NoteEditorHandle = {
  /**
   * 把光标放到正文开头。标题栏按回车时用。
   *
   * 不能直接用 `editor.focus()`：它恢复的是编辑器上一次的选区，如果用户在跳去
   * 改标题之前刚好选中过正文的某一行，回来之后敲的字会一个个覆盖掉那一行。
   */
  focusStart: () => void
}

type Props = {
  /** 存量正文，只在挂载时读一次 —— 挂载之后编辑器自己是内容的主人。 */
  initialContent: string
  /** 用户敲了东西才会调；灌入老格式的那一次不算。 */
  onChange: (content: string) => void
  ref?: Ref<NoteEditorHandle>
}

/**
 * 笔记正文编辑器。
 *
 * 词典是建实例时定死的，所以换界面语言只能重建实例 —— 用 `key` 换掉，重建时
 * 吃的是页面手上最新的正文，不会掉字。
 */
export function NoteEditor(props: Props) {
  const { language } = useI18n()
  return <NoteEditorInstance key={language} {...props} />
}

function NoteEditorInstance({ initialContent, onChange, ref }: Props) {
  const { theme } = useTheme()
  const { language } = useI18n()

  // 存量正文只认挂载那一刻的值：往后 `initialContent` 会跟着页面 state 变，
  // 再读一次会把光标和撤销栈冲掉。
  const [stored] = useState(() => readStoredContent(initialContent))
  // 老格式是异步灌进去的，那一次的 onChange 不能当成用户编辑，否则光是打开一
  // 篇老笔记就会触发保存。
  const isHydrating = useRef(stored.kind === 'html')

  const editor = useCreateBlockNote(
    {
      initialContent: stored.kind === 'blocks' ? stored.blocks : undefined,
      dictionary: BLOCKNOTE_LOCALES[language],
    },
    [],
  )

  useImperativeHandle(
    ref,
    () => ({
      focusStart: () => {
        // 先把光标钉在第一个块的开头，再聚焦，免得旧选区被恢复出来。
        const firstBlock = editor.document[0]
        if (firstBlock) editor.setTextCursorPosition(firstBlock, 'start')
        editor.focus()
      },
    }),
    [editor],
  )

  useEffect(() => {
    if (stored.kind !== 'html') return
    let cancelled = false

    void (async () => {
      const blocks = await editor.tryParseHTMLToBlocks(stored.html)
      if (cancelled) return
      editor.replaceBlocks(editor.document, blocks)
      // 等 ProseMirror 把这次事务派发完再放行。
      setTimeout(() => {
        isHydrating.current = false
      }, 0)
    })()

    return () => {
      cancelled = true
    }
  }, [editor, stored])

  return (
    // 外面这层是我们自己的卡片。样式不能直接挂在 BlockNoteView 的 className 上：
    // BlockNote 会把它同时贴到编辑器根节点和一个嵌套的空 portal 节点上，卡片会被
    // 画两遍，第二个是空的，看着就是凭空多出来一个框。
    <div className="note-editor">
      <BlockNoteView
        className="note-editor-view"
        editor={editor}
        theme={theme}
        onChange={() => {
          if (isHydrating.current) return
          onChange(JSON.stringify(editor.document))
        }}
      />
    </div>
  )
}
