import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@heroui/react'
import { Lightbulb } from 'lucide-react'
import { SelectField } from '../components/ui/SelectField'
import { useSearchParams } from 'react-router'
import type { DictEntriesResult } from '../api/dict'
import type { IndexRow } from '../lib/dictIndex'
import {
  DIRECTION_LABEL,
  DIRECTIONS,
  detectDirection,
  resolveByDict,
  type DirectionChoice,
  type SearchDirection,
} from '../lib/searchDirection'
import { DictIndexPanel } from '../components/DictIndexPanel'
import { SearchSuggest, type SearchSuggestHandle } from '../components/SearchSuggest'
import { WordLookupCard } from '../components/WordLookupCard'
import { usePageActive } from '../components/layout/pageContext'
import { useWordLookup } from '../hooks/useWordLookup'
import { useI18n } from '../i18n'
import { useSettings } from '../store/useSettings'

const DIRECTION_KEY = 'word-search-direction'

function readStoredChoice(): DirectionChoice {
  if (typeof window === 'undefined') return 'auto'
  const stored = window.localStorage.getItem(DIRECTION_KEY)
  return stored === 'auto' || DIRECTIONS.some((direction) => direction === stored)
    ? (stored as DirectionChoice)
    : 'auto'
}

export function WordSearchPage() {
  const { t } = useI18n()
  const [searchParams, setSearchParams] = useSearchParams()
  const q = searchParams.get('q') ?? ''
  const localDictEnabled = useSettings((state) => state.settings.localDictEnabled)
  // Deliberately empty even when the URL already carries a `?q=` — the box is
  // for the *next* search; the current one is what the results below show.
  const [keyword, setKeyword] = useState('')
  const [choice, setChoice] = useState<DirectionChoice>(readStoredChoice)
  // 「自动」当前落在哪个方向。纯汉字输入字符层面判不出来（中日共用），这时保持
  // 不动，等这次查询的词典结果回来再定 —— 所以它是 state，不是纯派生。
  const [autoDirection, setAutoDirection] = useState<SearchDirection>('zh-ja')
  const [error, setError] = useState<string | null>(null)

  // Arriving on the page — first mount, or coming back from another one — hands
  // over an empty box with the cursor already in it, so clicking the sidebar
  // entry is enough to start typing. What is below stays put: the last lookup
  // is still there to read. Cleared during render rather than in the effect so
  // the incoming frame is already empty, same as the `?q=` reset further down.
  const searchRef = useRef<SearchSuggestHandle>(null)
  const isActive = usePageActive()
  const [wasActive, setWasActive] = useState(isActive)
  if (wasActive !== isActive) {
    setWasActive(isActive)
    if (isActive) setKeyword('')
  }
  useEffect(() => {
    if (isActive) searchRef.current?.focus()
  }, [isActive])

  // 下拉选的方向记住，下次进页面还是它。
  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(DIRECTION_KEY, choice)
  }, [choice])

  // What the page is currently about: whatever is being typed, falling back to
  // the query the result on screen came from once the box has been cleared.
  const activeTerm = keyword.trim() || q.trim()

  // 字符层面能定方向的输入（假名 / 拉丁字母）当场就定，纯汉字返回 null ——
  // 那时保持上一次的方向不动，等 q 的词典结果回来用词库判（见 handleLoaded）。
  // 放在渲染期同步而不是 effect 里：effect 改 state 要多跑一帧，索引栏会先按
  // 旧方向渲染一次再跳。初值是空串而不是 activeTerm，好让带着 `?q=` 直接进
  // 页面（刷新、分享链接）的第一帧也走一遍判定。
  const [syncedTerm, setSyncedTerm] = useState('')
  if (syncedTerm !== activeTerm) {
    setSyncedTerm(activeTerm)
    const detected = detectDirection(activeTerm)
    if (detected && detected !== autoDirection) setAutoDirection(detected)
  }

  const direction: SearchDirection = choice === 'auto' ? autoDirection : choice

  const lookup = useWordLookup({
    term: q,
    direction,
    // 查的就是屏幕上这个词。活用形不背着人换成辞書形 —— 上面那条建议行走，
    // 用户点了才换。
    normalize: false,
    // 纯汉字 + 自动：到词典结果回来这一步才判得了方向 —— 日语词库收了这个词头
    // 就按日语词看，没收就当中文词翻成日语。用户显式选过方向就不插手。
    // 不必 useCallback：hook 把它存在 ref 里，身份变了也不会重查。
    onLoaded: (result: DictEntriesResult) => {
      const term = q.trim()
      if (!term) return
      if (choice === 'auto' && detectDirection(term) === null) {
        setAutoDirection(resolveByDict(term, result.entries))
      }
    },
  })

  /** The one submit path: Enter in the box, a picked suggestion, the button. */
  const submitKeyword = (raw: string = keyword) => {
    const text = raw.trim()
    if (!text) {
      setError(t('wordSearch.enterKeyword'))
      return
    }
    setError(null)
    setKeyword(text)
    // Same query as the URL — results are already on screen; AI is now
    // button-driven, so there is nothing to re-fire here.
    if (text !== q) setSearchParams({ q: text })
  }

  /**
   * 从右侧索引点词：回填输入框并按当前方向查这个词。
   *
   * 顺手把方向从「自动」定死成索引当前翻的这一本 —— 索引里这一行属于哪个方向
   * 是确定的，再交给自动判定重猜一遍，「保護」这种中日共有的词就会跑到另一个
   * 方向去。走 setSearchParams 和回车是同一条路，所以 URL 里始终留着当前查的
   * 词，刷新和分享链接都还原得回来。
   */
  const handlePickFromIndex = (row: IndexRow) => {
    setChoice(direction)
    setKeyword(row.word)
    setError(null)
    if (row.word !== q) setSearchParams({ q: row.word })
  }

  const hasQuery = q.trim().length > 0
  const { baseForm, meta } = lookup

  // 右侧索引栏定位用的词：查的是活用形时停在辞書形那一行 —— 索引里根本没有
  // 「食べました」这一行，不换就会落到毫无关系的位置。定位不改变查的是什么，
  // 所以这里可以直接用建议值；输入框已经在敲别的词时仍跟着输入走。
  const indexTerm = baseForm && activeTerm === q.trim() ? baseForm : activeTerm

  // 方向下拉。「自动」把当前判出来的方向写在标签里，省得用户去猜它选了哪边。
  const directionOptions = useMemo(
    () => [
      {
        value: 'auto' as DirectionChoice,
        label: t('wordSearch.dirAuto', { dir: t(DIRECTION_LABEL[autoDirection]) }),
      },
      ...DIRECTIONS.map((each) => ({
        value: each as DirectionChoice,
        label: t(DIRECTION_LABEL[each]),
      })),
    ],
    [t, autoDirection],
  )

  return (
    <section className="page">
      <div className="section-header">
        <div>
          <h2>{t('wordSearch.title')}</h2>
          <p className="muted">
            {localDictEnabled
              ? t('wordSearch.subtitle')
              : t('wordSearch.subtitleAiOnly')}
          </p>
        </div>
      </div>

      <div className="flex items-start gap-5">
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <div className="card grid gap-2.5">
            <div className="flex flex-wrap items-center gap-2.5">
              <SearchSuggest
                ref={searchRef}
                value={keyword}
                onChange={setKeyword}
                onSubmit={submitKeyword}
                placeholder={t('wordSearch.placeholder')}
                inputClassName="w-full rounded-xl border border-border bg-surface px-3.5 py-3 text-[15px] text-foreground focus:border-accent focus:ring-3 focus:ring-accent/15 focus:outline-none"
                className="min-w-[200px] flex-[1_1_240px] max-[720px]:basis-full"
              />
              <SelectField
                aria-label={t('wordSearch.directionLabel')}
                value={choice}
                onChange={setChoice}
                className="min-w-[160px] shrink-0"
                options={directionOptions}
              />
              <Button type="button" onPress={() => submitKeyword()}>
                {t('wordSearch.search')}
              </Button>
            </div>
            {error ? <p className="error-text m-0">{error}</p> : null}
          </div>

          {hasQuery ? (
            <WordLookupCard lookup={lookup}>
              {/* 辞書形建议：输入是活用形时摆在整张卡最上面。只提示不改写 ——
                  点了才把输入框和这次查询一起换成辞書形，故意查活用形的人
                  照样查得到。 */}
              {baseForm ? (
                <button
                  type="button"
                  onClick={() => submitKeyword(baseForm)}
                  className="flex w-full items-center gap-2 rounded-xl border border-dashed border-accent/40 bg-accent/5 px-3 py-2 text-left text-[13px] text-muted transition-colors hover:bg-accent/10"
                >
                  <Lightbulb className="size-3.5 shrink-0 text-accent" aria-hidden />
                  <span className="min-w-0 flex-1">
                    {t('wordSearch.baseFormSuggest', {
                      input: q.trim(),
                      base: baseForm,
                    })}
                  </span>
                  <span className="shrink-0 font-medium text-accent">
                    {t('wordSearch.baseFormSwitch')}
                  </span>
                </button>
              ) : null}
            </WordLookupCard>
          ) : null}
        </div>

        {/* 中→英 没有中英词头表可翻，整条侧栏就不占地方了。 */}
        {meta.index ? (
          <DictIndexPanel
            kind={meta.index}
            query={indexTerm}
            onPick={handlePickFromIndex}
          />
        ) : null}
      </div>
    </section>
  )
}
