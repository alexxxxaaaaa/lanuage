import type { ReactNode } from 'react'

type Props = {
  /** 来源名，如「AI 词典」「Wiktextract 词库」。 */
  title: string
  /** 标题右侧的计数、状态或操作按钮。 */
  aside?: ReactNode
  children: ReactNode
}

/**
 * 查词结果里一个「来源」的外壳。
 *
 * 我的单词库、本地词库、AI 词典各是一块，共用这一个外壳，
 * 三者的标题栏、间距、边框才会完全对齐 —— 来源之间的差异只体现在内容上。
 */
export function SourceSection({ title, aside, children }: Props) {
  return (
    <article className="card">
      <div className="mb-3 flex min-h-8 items-center justify-between gap-3">
        <h3 className="m-0 text-base">{title}</h3>
        {aside}
      </div>
      {children}
    </article>
  )
}
