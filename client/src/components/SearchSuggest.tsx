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
import { lookupDictionary } from '../api/dictionary'
import { getWordSuggestions, type WordSuggestion } from '../api/words'

type DictItem = {
  word: string
  reading: string
}

type Suggestion =
  | { kind: 'library'; data: WordSuggestion }
  | { kind: 'dictionary'; data: DictItem }

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

const SECTION_LABEL =
  'border-t border-border bg-foreground/3 px-3 py-1.5 text-xs text-muted first:border-t-0'
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

export const SearchSuggest = forwardRef<SearchSuggestHandle, Props>(function SearchSuggest(
  { value, onChange, onSubmit, placeholder, className, inputClassName },
  ref,
) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [library, setLibrary] = useState<WordSuggestion[]>([])
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

  // Combined, deduped list of suggestions: library first, dictionary second.
  const items = useMemo<Suggestion[]>(() => {
    const libCapped = library.slice(0, MAX_PER_SECTION)
    const libKeys = new Set(libCapped.map((w) => `${w.word}|${w.reading}`))
    const dictCapped = dictionary
      .filter((d) => !libKeys.has(`${d.word}|${d.reading}`))
      .slice(0, MAX_PER_SECTION)
    return [
      ...libCapped.map((data) => ({ kind: 'library' as const, data })),
      ...dictCapped.map((data) => ({ kind: 'dictionary' as const, data })),
    ]
  }, [library, dictionary])

  // Debounced remote fetch; IME composition pauses lookups so we don't fire
  // on every pinyin/romaji keystroke.
  useEffect(() => {
    const trimmed = value.trim()
    if (!trimmed || isComposing) {
      setLibrary([])
      setDictionary([])
      return
    }
    const controller = new AbortController()
    const handle = window.setTimeout(() => {
      void (async () => {
        const detected = detectInputLang(trimmed)
        const [libResult, dictResult] = await Promise.allSettled([
          getWordSuggestions(trimmed, { limit: 10, signal: controller.signal }),
          lookupDictionary(trimmed, dictLangFor(detected), {
            signal: controller.signal,
          }),
        ])
        if (controller.signal.aborted) return
        if (libResult.status === 'fulfilled') {
          setLibrary(libResult.value)
        } else if (!axios.isCancel(libResult.reason)) {
          setLibrary([])
        }
        if (dictResult.status === 'fulfilled') {
          // We only show word + reading for dictionary candidates — meanings
          // from the dictionary aren't trusted, the user picks one and the
          // search page runs an AI lookup on the chosen word.
          setDictionary(
            dictResult.value.map((d) => ({ word: d.word, reading: d.reading })),
          )
        } else if (!axios.isCancel(dictResult.reason)) {
          setDictionary([])
        }
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
      commit(highlight >= 0 ? items[highlight].data.word : value)
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
          {library.slice(0, MAX_PER_SECTION).length > 0 ? (
            <div className={SECTION_LABEL}>我的词库</div>
          ) : null}
          {items.map((item, idx) => {
            const isLib = item.kind === 'library'
            const baseIdx = idx
            const isHighlighted = baseIdx === highlight
            // Insert a section divider before the first dictionary item.
            const prev = idx > 0 ? items[idx - 1] : null
            const showDictHeader = !isLib && (prev === null || prev.kind === 'library')
            return (
              <div key={`${item.kind}-${idx}-${item.data.word}`}>
                {showDictHeader ? <div className={SECTION_LABEL}>字典</div> : null}
                <button
                  type="button"
                  className={`flex w-full min-w-0 cursor-pointer flex-col gap-0.5 border-none bg-transparent px-3 py-2 text-left font-[inherit] text-inherit hover:bg-accent-soft ${
                    isHighlighted ? 'bg-accent-soft' : ''
                  }`}
                  onMouseEnter={() => setHighlight(baseIdx)}
                  onClick={() => commit(item.data.word)}
                >
                  <div className="flex w-full min-w-0 items-baseline gap-2.5">
                    {/* CJK breaks between any two characters, so these spans
                        truncate rather than wrap. */}
                    <span className={`${TRUNCATE} font-semibold`}>{item.data.word}</span>
                    {item.data.reading && item.data.reading !== item.data.word ? (
                      <span className={`${TRUNCATE} text-[0.9em] text-muted`}>
                        {item.data.reading}
                      </span>
                    ) : null}
                  </div>
                  {isLib && 'meaning' in item.data && item.data.meaning ? (
                    <div className="w-full truncate text-[0.85em] text-muted">
                      {item.data.meaning}
                    </div>
                  ) : null}
                </button>
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
})
