import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ScrollShadow, Spinner, Tabs } from '@heroui/react'
import { DictIndex, type DictDirection, type IndexRow } from '../lib/dictIndex'
import { useI18n } from '../i18n'

/** 行高固定 —— 定位和可见区间都靠它直接算，不用测量任何 DOM。 */
const ROW_HEIGHT = 52

/** 可见区间上下各多渲染几行，快速滚动时不会露出空白。 */
const OVERSCAN = 6

/**
 * 索引解析一次要几十毫秒，切 Tab 来回跳不该重复付这个成本，
 * 所以缓存放模块级：组件卸载重挂也复用。同一方向的并发加载合并成一个 Promise。
 */
const loaded = new Map<DictDirection, DictIndex>()
const loading = new Map<DictDirection, Promise<DictIndex>>()

function getIndex(direction: DictDirection): Promise<DictIndex> {
  const cached = loaded.get(direction)
  if (cached) return Promise.resolve(cached)

  const inflight = loading.get(direction)
  if (inflight) return inflight

  const task = DictIndex.load(direction)
    .then((index) => {
      loaded.set(direction, index)
      // 按词头排序留到空闲时段做，别让它砸在用户敲第一个汉字的那一帧上。
      const idle = window.requestIdleCallback ?? ((fn: () => void) => setTimeout(fn, 200))
      idle(() => index.warmUp())
      return index
    })
    .finally(() => loading.delete(direction))
  loading.set(direction, task)
  return task
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
  /**
   * 点某个词：父级负责回填输入框并展示该词的本地释义。
   * 不带方向 —— 查词按词头两个方向一起出，「保護」这种共有词两边都该看到。
   */
  onPick: (row: IndexRow) => void
}

/**
 * 右侧的本地词库索引栏 —— 相当于纸质辞书的词头一览。
 *
 * 数据来自随前端发布的静态 .idx 文件，定位、滚动全在本地完成，敲一个字就
 * 跳一次也不产生任何请求。窄屏直接不渲染：它是桌面端的翻阅辅助，
 * 手机上挤不下也没意义。
 *
 * 列表是自己按 scrollTop 算可见区间做的虚拟化，没有用 HeroUI 的 Virtualizer。
 * 后者只虚拟化 DOM：React Aria 在渲染前要先给 items 里每一条建一个 collection
 * node，11 万条全部建完才轮到虚拟化挑那十几行渲染，开列表时会卡死几秒。
 * 这里从头到尾只碰可见的那十几行，滚动条仍然覆盖全部词条。
 */
export function DictIndexPanel({ query, onPick }: Props) {
  const { t } = useI18n()
  const [direction, setDirection] = useState<DictDirection>('ja-zh')
  const [index, setIndex] = useState<DictIndex | null>(null)
  const [failed, setFailed] = useState(false)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewport, setViewport] = useState(0)

  // 输入语种明确时跟着切方向；含糊（纯汉字）时保持用户当前的选择。
  // 在渲染期同步而不是放进 effect：effect 里改 state 会多跑一帧，
  // 列表会先按旧方向渲染一次再跳。
  const [syncedQuery, setSyncedQuery] = useState(query)
  if (syncedQuery !== query) {
    setSyncedQuery(query)
    const inferred = directionFromQuery(query)
    if (inferred && inferred !== direction) setDirection(inferred)
  }

  // 切方向要立刻换掉列表内容，否则新索引到位前旧方向的词还挂在上面。
  // 命中缓存时这一步直接把索引装好，连 loading 态都不会闪。
  const [loadedFor, setLoadedFor] = useState<DictDirection | null>(null)
  if (loadedFor !== direction) {
    setLoadedFor(direction)
    setIndex(loaded.get(direction) ?? null)
    setFailed(false)
  }

  useEffect(() => {
    let cancelled = false
    void getIndex(direction)
      .then((next) => {
        if (!cancelled) setIndex(next)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [direction])

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

  const tabs: { id: DictDirection; label: string }[] = [
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

      <Tabs
        selectedKey={direction}
        onSelectionChange={(key) => setDirection(key as DictDirection)}
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

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-surface">
        {failed ? (
          <p className="muted m-0 p-4 text-[13px]">{t('wordSearch.indexFailed')}</p>
        ) : !index ? (
          <div className="flex items-center justify-center gap-2 p-6">
            <Spinner size="sm" />
            <span className="muted text-[13px]">{t('wordSearch.indexLoading')}</span>
          </div>
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
                  <span className="truncate text-[15px] text-foreground">{row.word}</span>
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
