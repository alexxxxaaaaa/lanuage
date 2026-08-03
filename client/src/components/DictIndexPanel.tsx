import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Chip, ScrollShadow, Spinner, Tabs } from '@heroui/react'
import {
  DictIndex,
  type DictDirection,
  type IndexEntry,
  type IndexKind,
  type IndexRow,
} from '../lib/dictIndex'
import { useI18n } from '../i18n'
import { useSettings } from '../store/useSettings'
import { useWordIndex } from '../store/useWordIndex'

/** 行高固定 —— 定位和可见区间都靠它直接算，不用测量任何 DOM。 */
const ROW_HEIGHT = 52

/** 可见区间上下各多渲染几行，快速滚动时不会露出空白。 */
const OVERSCAN = 6

/** 每种索引对应的用户词语言。中→日 没有 AI 词：AI 生成的词头都是日语。 */
const USER_WORD_LANGUAGE: Record<IndexKind, string> = {
  'ja-zh': 'jp',
  'zh-ja': '',
  en: 'en',
}

/**
 * 静态索引解析一次要几十毫秒，切 Tab 来回跳不该重复付这个成本，
 * 所以缓存放模块级：组件卸载重挂也复用。同一方向的并发加载合并成一个 Promise。
 */
const localEntries = new Map<DictDirection, IndexEntry[]>()
const localLoading = new Map<DictDirection, Promise<IndexEntry[]>>()

function getLocalEntries(direction: DictDirection): Promise<IndexEntry[]> {
  const cached = localEntries.get(direction)
  if (cached) return Promise.resolve(cached)

  const inflight = localLoading.get(direction)
  if (inflight) return inflight

  const task = DictIndex.loadLocal(direction)
    .then((entries) => {
      localEntries.set(direction, entries)
      return entries
    })
    .finally(() => localLoading.delete(direction))
  localLoading.set(direction, task)
  return task
}

/**
 * 合并结果同样缓存住 —— 归并十万条加上按词头预排序不便宜，切 Tab / 切开关
 * 不该每次重来。用户词一变（revision 自增）整份缓存作废。
 */
const mergedIndexes = new Map<string, DictIndex>()
let mergedRevision = -1

function mergedKey(kind: IndexKind, withLocal: boolean) {
  return `${kind}|${withLocal ? 1 : 0}`
}

function peekIndex(kind: IndexKind, withLocal: boolean, revision: number) {
  return mergedRevision === revision
    ? (mergedIndexes.get(mergedKey(kind, withLocal)) ?? null)
    : null
}

async function buildIndex(
  kind: IndexKind,
  withLocal: boolean,
  revision: number,
): Promise<DictIndex> {
  if (mergedRevision !== revision) {
    mergedIndexes.clear()
    mergedRevision = revision
  }
  const key = mergedKey(kind, withLocal)
  const cached = mergedIndexes.get(key)
  if (cached) return cached

  const local = withLocal && kind !== 'en' ? await getLocalEntries(kind) : []
  const language = USER_WORD_LANGUAGE[kind]
  const mine = useWordIndex
    .getState()
    .items.filter((item) => item.language === language)

  const index = DictIndex.merge(kind, local, mine)
  mergedIndexes.set(key, index)
  // 按词头排序留到空闲时段做，别让它砸在用户敲第一个汉字的那一帧上。
  const idle = window.requestIdleCallback ?? ((fn: () => void) => setTimeout(fn, 200))
  idle(() => index.warmUp())
  return index
}

const HAS_KANA = /[぀-ヿ]/
const HAS_LATIN = /[a-zA-Z]/

/**
 * 从输入内容推断该看哪个方向。只在信号明确时给答案：
 * 假名一定是日语，拉丁字母在这个场景下是拼音。汉字两边都可能，返回 null
 * 表示不动 —— 免得用户手动切到某个 Tab 后又被输入内容顶回去。
 */
function directionFromQuery(query: string): DictDirection | null {
  if (HAS_KANA.test(query)) return 'ja-zh'
  if (HAS_LATIN.test(query)) return 'zh-ja'
  return null
}

type Props = {
  /** 搜索框当前内容，用来定位索引。 */
  query: string
  /** 查的是哪种语言的词 —— 决定索引里出现哪一批 AI 添加的词。 */
  language: 'en' | 'jp'
  /**
   * 点某个词：父级负责回填输入框并展示该词的释义。
   * 不带方向 —— 查词按词头两个方向一起出，「保護」这种共有词两边都该看到。
   */
  onPick: (row: IndexRow) => void
}

/**
 * 右侧的词库索引栏 —— 相当于纸质辞书的词头一览。
 *
 * 内容是本地词库 + 我的单词库（AI 查词添加的词）合起来的一份词头表，
 * 每行标出它的来源。设置里关掉本地词库后只剩 AI 添加的词，此时全部同源，
 * 标签和日中/中日的分栏一并收起。日语之外没有本地词库，索引里同样只有 AI 词。
 *
 * 定位、滚动全在本地完成，敲一个字就跳一次也不产生任何请求。窄屏直接不渲染：
 * 它是桌面端的翻阅辅助，手机上挤不下也没意义。
 *
 * 列表是自己按 scrollTop 算可见区间做的虚拟化，没有用 HeroUI 的 Virtualizer。
 * 后者只虚拟化 DOM：React Aria 在渲染前要先给 items 里每一条建一个 collection
 * node，11 万条全部建完才轮到虚拟化挑那十几行渲染，开列表时会卡死几秒。
 * 这里从头到尾只碰可见的那十几行，滚动条仍然覆盖全部词条。
 */
export function DictIndexPanel({ query, language, onPick }: Props) {
  const { t } = useI18n()
  const localDictEnabled = useSettings((state) => state.settings.localDictEnabled)
  const revision = useWordIndex((state) => state.revision)
  const [index, setIndex] = useState<DictIndex | null>(null)
  const [failed, setFailed] = useState(false)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewport, setViewport] = useState(0)

  useEffect(() => {
    useWordIndex.getState().load()
  }, [])

  // 只有日语查词能用上本地词库，也只有这时才需要分日中 / 中日两栏。
  const withLocal = localDictEnabled && language === 'jp'
  const kinds: IndexKind[] = useMemo(
    () => (language === 'en' ? ['en'] : withLocal ? ['ja-zh', 'zh-ja'] : ['ja-zh']),
    [language, withLocal],
  )

  const [kind, setKind] = useState<IndexKind>(kinds[0])
  // 可选形态变了（切语言 / 开关本地词库）而当前这个已经不在里面，退回第一个。
  if (!kinds.includes(kind)) setKind(kinds[0])

  // 输入语种明确时跟着切方向；含糊（纯汉字）时保持用户当前的选择。
  // 在渲染期同步而不是放进 effect：effect 里改 state 会多跑一帧，
  // 列表会先按旧方向渲染一次再跳。
  const [syncedQuery, setSyncedQuery] = useState(query)
  if (syncedQuery !== query) {
    setSyncedQuery(query)
    const inferred = directionFromQuery(query)
    if (inferred && inferred !== kind && kinds.includes(inferred)) setKind(inferred)
  }

  // 换索引要立刻换掉列表内容，否则新索引到位前旧的还挂在上面。
  // 命中缓存时这一步直接把索引装好，连 loading 态都不会闪。
  const cacheKey = `${mergedKey(kind, withLocal)}|${revision}`
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  if (loadedFor !== cacheKey) {
    setLoadedFor(cacheKey)
    setIndex(peekIndex(kind, withLocal, revision))
    setFailed(false)
  }

  useEffect(() => {
    let cancelled = false
    void buildIndex(kind, withLocal, revision)
      .then((next) => {
        if (!cancelled) setIndex(next)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [kind, withLocal, revision])

  // 视口高度决定要渲染几行。用 ResizeObserver 而不是读一次 clientHeight：
  // 侧栏高度跟着窗口变，折叠浏览器窗口后区间要跟着重算。
  // observe() 本身会立刻回调一次初始尺寸，所以不必在这里同步读一遍。
  // 依赖 index：列表要等索引就绪才渲染，容器是跟着它挂载的。
  useEffect(() => {
    const node = scrollRef.current
    if (!node) return
    const observer = new ResizeObserver(([entry]) => setViewport(entry.contentRect.height))
    observer.observe(node)
    return () => observer.disconnect()
  }, [index])

  // 滚动事件按帧合并 —— 一次滚动能触发几十个 scroll 事件，
  // 每个都 setState 会把渲染次数放大到没有必要的程度。
  const rafRef = useRef(0)
  const handleScroll = useCallback(() => {
    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0
      setScrollTop(scrollRef.current?.scrollTop ?? 0)
    })
  }, [])
  useEffect(() => () => cancelAnimationFrame(rafRef.current), [])

  // 定位是纯计算，直接从 index + query 派生。二分查找十几次比较，
  // 但按词头查那条路首次会排一次序，所以仍然 memo 住。
  const activeLine = useMemo(() => (index ? index.locate(query) : 0), [index, query])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: activeLine * ROW_HEIGHT })
  }, [activeLine])

  const total = index?.size ?? 0
  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  const last = Math.min(total, Math.ceil((scrollTop + viewport) / ROW_HEIGHT) + OVERSCAN)
  const visible = index ? index.rows.slice(first, last) : []

  // 索引里只有一种来源时标签是废话：关掉本地词库、或者查的不是日语，
  // 剩下的全是 AI 添加的词。
  const showTags = withLocal

  const tabs: { id: IndexKind; label: string }[] = [
    { id: 'ja-zh', label: t('wordSearch.indexJaZh') },
    { id: 'zh-ja', label: t('wordSearch.indexZhJa') },
  ]

  return (
    <aside className="sticky top-4 hidden h-[calc(100vh-7rem)] w-[300px] shrink-0 flex-col gap-3 xl:flex">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="m-0 text-base">{t('wordSearch.indexTitle')}</h3>
        <span className="muted text-[13px]">
          {index ? t('wordSearch.indexCount', { count: index.size }) : ''}
        </span>
      </div>

      {kinds.length > 1 ? (
        <Tabs
          selectedKey={kind}
          onSelectionChange={(key) => setKind(key as IndexKind)}
          variant="secondary"
        >
          <Tabs.ListContainer>
            <Tabs.List aria-label={t('wordSearch.indexTitle')}>
              {tabs.map((tab) => (
                <Tabs.Tab key={tab.id} id={tab.id}>
                  {tab.label}
                  <Tabs.Indicator />
                </Tabs.Tab>
              ))}
            </Tabs.List>
          </Tabs.ListContainer>
        </Tabs>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-surface">
        {failed ? (
          <p className="muted m-0 p-4 text-[13px]">{t('wordSearch.indexFailed')}</p>
        ) : !index ? (
          <div className="flex items-center justify-center gap-2 p-6">
            <Spinner size="sm" />
            <span className="muted text-[13px]">{t('wordSearch.indexLoading')}</span>
          </div>
        ) : total === 0 ? (
          <p className="muted m-0 p-4 text-[13px]">{t('wordSearch.indexEmpty')}</p>
        ) : (
          // hideScrollBar 藏掉滚动条，上下边缘的渐隐代替它提示「还有内容」——
          // 索引列表本来就靠输入定位，滚动条既指示不了位置也没人拖。
          <ScrollShadow
            ref={scrollRef}
            onScroll={handleScroll}
            hideScrollBar
            size={28}
            role="listbox"
            aria-label={t('wordSearch.indexTitle')}
            tabIndex={-1}
            className="h-full w-full overflow-y-auto"
          >
            {/* 撑出全部词条的总高度，滚动范围才是整本词库而不是当前这一屏。 */}
            <div className="relative" style={{ height: total * ROW_HEIGHT }}>
              {visible.map((row) => (
                <button
                  key={row.line}
                  type="button"
                  role="option"
                  aria-selected={row.line === activeLine}
                  aria-setsize={total}
                  aria-posinset={row.line + 1}
                  onClick={() => onPick(row)}
                  style={{ top: row.line * ROW_HEIGHT, height: ROW_HEIGHT }}
                  className={`absolute inset-x-0 flex flex-col justify-center gap-0.5 px-3 text-left transition-colors duration-100 ${
                    row.line === activeLine
                      ? 'bg-accent/10 hover:bg-accent/15'
                      : 'hover:bg-accent/6'
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-[15px] text-foreground">{row.word}</span>
                    {showTags && row.source !== 'ai' ? (
                      <Chip size="sm" variant="soft">
                        {t('wordSearch.tagLocal')}
                      </Chip>
                    ) : null}
                    {showTags && row.source !== 'local' ? (
                      <Chip size="sm" color="accent" variant="soft">
                        {t('wordSearch.tagAi')}
                      </Chip>
                    ) : null}
                  </span>
                  {row.reading ? (
                    <span className="muted truncate text-[12px]">{row.reading}</span>
                  ) : null}
                </button>
              ))}
            </div>
          </ScrollShadow>
        )}
      </div>

      <p className="muted m-0 text-[12px]">{t('wordSearch.indexHint')}</p>
    </aside>
  )
}
