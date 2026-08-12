import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import axios from 'axios'
import { fetchRelatedWords, type RelatedWord } from '../api/dict'
import { lookupDictionary } from '../api/dictionary'
import { getWordSuggestions, type WordSuggestion } from '../api/words'
import { useI18n } from '../i18n'

type DictItem = {
  word: string
  reading: string
}

/** 弹窗里的一行。三节共用一套形状，键盘上下键才能一路走到底。 */
type SuggestRow = {
  word: string
  reading: string
  /** 词头下面那行灰字：单词库给释义，关联词给词库释义，字典没有。 */
  detail: string
}

type Section = {
  key: string
  label: string
  rows: SuggestRow[]
  /** 本节第一行在扁平列表里的下标，高亮和键盘定位共用一套坐标。 */
  offset: number
}

export type SearchSuggestHandle = {
  focus: () => void
}

type Props = {
  value: string
  onChange: (next: string) => void
  onSubmit: (text: string) => void
  placeholder?: string
  className?: string
  inputClassName?: string
}

/** Debounce before firing remote lookups. */
const DEBOUNCE_MS = 250
const MAX_PER_SECTION = 5

/** 分节标题。分隔线画在整节外面，否则每节的第一个子元素都吃到 first: 而全不画。 */
const SECTION_LABEL = 'bg-foreground/3 px-3 py-1.5 text-xs text-muted'
/** Single-line with ellipsis, shrinkable inside a flex row. */
const TRUNCATE = 'min-w-0 flex-[0_1_auto] truncate'

// 3-state detection: kana → jp (unambiguous); only kanji → zh (ambiguous,
// could be Chinese or Japanese — we route through Jisho anyway since shared
// kanji often produces useful matches); ASCII → en.
function detectInputLang(text: string): 'zh' | 'jp' | 'en' {
  if (/[぀-ヿㇰ-ㇿ]/.test(text)) return 'jp'
  if (/[一-龯]/.test(text)) return 'zh'
  if (/[a-zA-Z]/.test(text)) return 'en'
  return 'en'
}

// Which dictionary API to call. zh input falls back to Jisho (returns the
// JP equivalents when the chars overlap; harmless when they don't).
function dictLangFor(input: 'zh' | 'jp' | 'en'): 'jp' | 'en' {
  return input === 'en' ? 'en' : 'jp'
}

/** 一路结果落地：失败清空，取消（换了输入）时留着，等新的那次覆盖。 */
function applyResult<T>(result: PromiseSettledResult<T[]>, set: (next: T[]) => void) {
  if (result.status === 'fulfilled') set(result.value)
  else if (!axios.isCancel(result.reason)) set([])
}

export const SearchSuggest = forwardRef<SearchSuggestHandle, Props>(function SearchSuggest(
  { value, onChange, onSubmit, placeholder, className, inputClassName },
  ref,
) {
  const { t } = useI18n()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [library, setLibrary] = useState<WordSuggestion[]>([])
  const [related, setRelated] = useState<RelatedWord[]>([])
  const [dictionary, setDictionary] = useState<DictItem[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [highlight, setHighlight] = useState(-1)
  const [isComposing, setIsComposing] = useState(false)
  const blurTimerRef = useRef<number | null>(null)

  useImperativeHandle(ref, () => ({
    // `preventScroll`: the caller focuses this on page entry, after the shell
    // has just restored that page's scroll offset — the browser's own
    // scroll-into-view would undo it.
    focus: () => inputRef.current?.focus({ preventScroll: true }),
  }))

  /**
   * 三节候选，按「有多大把握是用户要的词」排：自己收过的词在最前，其次是本地
   * 词库按读音找出的关联词（精确、离线），最后是字典的模糊匹配。
   *
   * 同一个词只留最靠前那一节的那一行 —— 点哪一行填进输入框的都是同一个词头，
   * 重复出现只是占地方。
   */
  const sections = useMemo<Section[]>(() => {
    const seen = new Set<string>()
    let offset = 0
    const build = <T,>(
      key: string,
      source: T[],
      limit: number,
      toRow: (item: T) => SuggestRow,
    ): Section => {
      const rows: SuggestRow[] = []
      for (const item of source) {
        if (rows.length >= limit) break
        const row = toRow(item)
        if (seen.has(row.word)) continue
        seen.add(row.word)
        rows.push(row)
      }
      const section = { key, label: t(`wordSearch.suggest.${key}`), rows, offset }
      offset += rows.length
      return section
    }

    return [
      build('library', library, MAX_PER_SECTION, (w) => ({
        word: w.word,
        reading: w.reading,
        detail: w.meaning,
      })),
      // 条数由服务端定死（同一个读音下的词头可能有几十个），这里不再截。
      build('related', related, related.length, (w) => ({
        word: w.word,
        reading: w.reading,
        detail: w.gloss,
      })),
      // 字典只用词头和读音 —— 它给的释义不入库，用户点中之后由查词页自己查。
      build('dictionary', dictionary, MAX_PER_SECTION, (d) => ({
        word: d.word,
        reading: d.reading,
        detail: '',
      })),
    ].filter((section) => section.rows.length > 0)
  }, [library, related, dictionary, t])

  /** 键盘上下键走的扁平列表，顺序和渲染顺序一致。 */
  const items = useMemo(() => sections.flatMap((section) => section.rows), [sections])

  // Debounced remote fetch; IME composition pauses lookups so we don't fire
  // on every pinyin/romaji keystroke.
  useEffect(() => {
    const trimmed = value.trim()
    if (!trimmed || isComposing) {
      setLibrary([])
      setRelated([])
      setDictionary([])
      return
    }
    const controller = new AbortController()
    const handle = window.setTimeout(() => {
      void (async () => {
        const detected = detectInputLang(trimmed)
        const results = await Promise.allSettled([
          getWordSuggestions(trimmed, { limit: 10, signal: controller.signal }),
          // 关联词只对可能是日语的输入查。纯拉丁字母在日中词库里一条都不会有，
          // 白问一次接口。
          detected === 'en'
            ? Promise.resolve<RelatedWord[]>([])
            : fetchRelatedWords(trimmed, { signal: controller.signal }),
          lookupDictionary(trimmed, dictLangFor(detected), {
            signal: controller.signal,
          }),
        ])
        if (controller.signal.aborted) return
        const [libResult, relatedResult, dictResult] = results
        applyResult(libResult, setLibrary)
        applyResult(relatedResult, setRelated)
        applyResult(dictResult, (list) =>
          setDictionary(list.map((d) => ({ word: d.word, reading: d.reading }))),
        )
      })()
    }, DEBOUNCE_MS)
    return () => {
      window.clearTimeout(handle)
      controller.abort()
    }
  }, [value, isComposing])

  // Reset highlight whenever the candidate list shape changes.
  useEffect(() => {
    setHighlight(-1)
  }, [items.length])

  const close = () => {
    setIsOpen(false)
    setHighlight(-1)
  }

  const commit = (text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    onChange(trimmed)
    onSubmit(trimmed)
    close()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || isComposing) return
    if (event.key === 'ArrowDown') {
      if (items.length === 0) return
      event.preventDefault()
      setIsOpen(true)
      setHighlight((idx) => (idx + 1) % items.length)
    } else if (event.key === 'ArrowUp') {
      if (items.length === 0) return
      event.preventDefault()
      setHighlight((idx) => (idx <= 0 ? items.length - 1 : idx - 1))
    } else if (event.key === 'Enter') {
      // No wrapping <form> — Enter is the submit path, for the highlighted
      // candidate when there is one and for the raw text otherwise.
      event.preventDefault()
      commit(highlight >= 0 ? items[highlight].word : value)
      close()
    } else if (event.key === 'Escape') {
      close()
    }
  }

  const handleFocus = () => {
    if (blurTimerRef.current !== null) {
      window.clearTimeout(blurTimerRef.current)
      blurTimerRef.current = null
    }
    if (value.trim()) setIsOpen(true)
  }

  const handleBlur = () => {
    // Delay so click-on-suggestion mousedown registers before close.
    blurTimerRef.current = window.setTimeout(() => setIsOpen(false), 150)
  }

  const handleChange = (next: string) => {
    onChange(next)
    if (next.trim()) {
      setIsOpen(true)
    } else {
      setIsOpen(false)
    }
  }

  const showDropdown = isOpen && items.length > 0

  return (
    <div className={`relative min-w-0 flex-1 ${className ?? ''}`}>
      <input
        ref={inputRef}
        type="search"
        value={value}
        placeholder={placeholder}
        className={`w-full ${inputClassName ?? ''}`}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onCompositionStart={() => setIsComposing(true)}
        onCompositionEnd={() => setIsComposing(false)}
        autoComplete="off"
      />
      {showDropdown ? (
        <div
          className="absolute top-[calc(100%+4px)] right-0 left-0 z-100 max-h-90 min-w-[280px] overflow-y-auto rounded-[10px] border border-border bg-overlay shadow-overlay"
          // Prevent input blur before click handler fires.
          onMouseDown={(e) => e.preventDefault()}
        >
          {sections.map((section) => (
            <div key={section.key} className="border-t border-border first:border-t-0">
              <div className={SECTION_LABEL}>{section.label}</div>
              {section.rows.map((row, idx) => {
                const at = section.offset + idx
                return (
                  <button
                    key={`${section.key}-${row.word}`}
                    type="button"
                    className={`flex w-full min-w-0 cursor-pointer flex-col gap-0.5 border-none bg-transparent px-3 py-2 text-left font-[inherit] text-inherit hover:bg-accent-soft ${
                      at === highlight ? 'bg-accent-soft' : ''
                    }`}
                    onMouseEnter={() => setHighlight(at)}
                    onClick={() => commit(row.word)}
                  >
                    <div className="flex w-full min-w-0 items-baseline gap-2.5">
                      {/* CJK breaks between any two characters, so these spans
                          truncate rather than wrap. */}
                      <span className={`${TRUNCATE} font-semibold`}>{row.word}</span>
                      {row.reading && row.reading !== row.word ? (
                        <span className={`${TRUNCATE} text-[0.9em] text-muted`}>
                          {row.reading}
                        </span>
                      ) : null}
                    </div>
                    {row.detail ? (
                      <div className="w-full truncate text-[0.85em] text-muted">
                        {row.detail}
                      </div>
                    ) : null}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
})
