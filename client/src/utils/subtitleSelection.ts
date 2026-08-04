// 字幕划词的 selection 读取。标准 API 直接用会踩两个坑：
//
// 1. 开了注音时一行字幕是 <ruby>復旧<rt>ふっきゅう</rt></ruby>，
//    Selection.toString() 会把 rt 里的假名一起吐出来 —— 划「復旧」拿到的是
//    「復旧ふっきゅう」，丢给 AI 查词直接查废。所以走 cloneContents() 把
//    rt/rp 摘掉再取 textContent。
// 2. 例句要「选中的词所在的那整句」，得知道落在哪一行 —— 从 range 两端往上
//    找带 id="podcast-line-N" 的祖先。跨行拖选没有单一例句可用，直接判无效。

export type SubtitleSelection = {
  /** 剥掉注音后的选中文本。 */
  text: string
  /** 选中落在 transcript 的第几行。 */
  lineIndex: number
  /** 选区在视口中的位置，浮动按钮用它定位。 */
  rect: DOMRect
}

const LINE_ID_PREFIX = 'podcast-line-'

function stripRuby(fragment: DocumentFragment): string {
  fragment.querySelectorAll('rt, rp').forEach((el) => el.remove())
  return fragment.textContent ?? ''
}

function lineIndexOf(node: Node | null): number {
  let el: HTMLElement | null =
    node instanceof HTMLElement ? node : (node?.parentElement ?? null)
  while (el) {
    if (el.id.startsWith(LINE_ID_PREFIX)) {
      const idx = Number(el.id.slice(LINE_ID_PREFIX.length))
      return Number.isInteger(idx) ? idx : -1
    }
    el = el.parentElement
  }
  return -1
}

export function readSubtitleSelection(): SubtitleSelection | null {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return null
  }
  const range = selection.getRangeAt(0)
  const text = stripRuby(range.cloneContents()).trim()
  if (!text) return null

  const start = lineIndexOf(range.startContainer)
  const end = lineIndexOf(range.endContainer)
  if (start < 0 || start !== end) return null

  return { text, lineIndex: start, rect: range.getBoundingClientRect() }
}

/** 清掉当前选区 —— 存完词后收起浮动按钮，免得它一直悬在那儿。 */
export function clearSelection() {
  window.getSelection()?.removeAllRanges()
}
