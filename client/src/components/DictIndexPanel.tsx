import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Chip, ScrollShadow, Spinner } from '@heroui/react'
import { Star } from 'lucide-react'
import {
  DictIndex,
  type DictDirection,
  type IndexEntry,
  type IndexKind,
  type IndexRow,
} from '../lib/dictIndex'
import { useJlptLevels } from '../lib/jlptVocab'
import { JlptChips } from './JlptChips'
import { useI18n } from '../i18n'
import { useSettings } from '../store/useSettings'
import { useWordIndex } from '../store/useWordIndex'

/** 行高固定 —— 定位和可见区间都靠它直接算，不用测量任何 DOM。 */
const ROW_HEIGHT = 52

/** 可见区间上下各多渲染几行，快速滚动时不会露出空白。 */
const OVERSCAN = 6

/** 每种索引对应的用户词语言。中→日 没有：AI 生成的词头都是日语或英语。 */
const USER_WORD_LANGUAGE: Record<IndexKind, string> = {
  'ja-zh': 'jp',
  'zh-ja': '',
  en: 'en',
}

/**
 * 静态索引解析一次要几十毫秒，换方向来回切不该重复付这个成本，
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
 * 合并结果同样缓存住 —— 归并十万条加上按词头预排序不便宜，换方向 / 切开关
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

type Props = {
  /** 翻哪本词头表 —— 由查词方向定，见 lib/searchDirection 的 DIRECTION_META。 */
  kind: IndexKind
  /** 搜索框当前内容，用来定位索引。 */
  query: string
  /** 点某一行：父级回填输入框并按当前方向展示这个词。 */
  onPick: (row: IndexRow) => void
}

/**
 * 右侧的词库索引栏 —— 相当于纸质辞书的词头一览。
 *
 * 翻的是哪一本由查词方向定死，栏内不再分栏：日→中 是日语词头表（本地词库 +
 * 我的单词库里 AI 添加的词），中→日 是中文词头表，英→中 只有我的英语词。
 * 每行标出它的来源，入过词单的行尾亮一颗星。
 *
 * 定位、滚动全在本地完成，敲一个字就跳一次也不产生任何请求。窄屏直接不渲染：
 * 它是桌面端的翻阅辅助，手机上挤不下也没意义。
 *
 * 列表是自己按 scrollTop 算可见区间做的虚拟化，没有用 HeroUI 的 Virtualizer。
 * 后者只虚拟化 DOM：React Aria 在渲染前要先给 items 里每一条建一个 collection
 * node，11 万条全部建完才轮到虚拟化挑那十几行渲染，开列表时会卡死几秒。
 * 这里从头到尾只碰可见的那十几行，滚动条仍然覆盖全部词条。
 */
export function DictIndexPanel({ kind, query, onPick }: Props) {
  const { t } = useI18n()
  const localDictEnabled = useSettings((state) => state.settings.localDictEnabled)
  const revision = useWordIndex((state) => state.revision)
  // 出題基準只有日语词表，另外两本词头表用不上它，也就不必下载。
  const jlptLevels = useJlptLevels(kind === 'ja-zh')
  const [index, setIndex] = useState<DictIndex | null>(null)
  const [failed, setFailed] = useState(false)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewport, setViewport] = useState(0)

  useEffect(() => {
    useWordIndex.getState().load()
  }, [])

  // 英语索引里只有 AI 添加的词，没有本地词库可以合。
  const withLocal = localDictEnabled && kind !== 'en'

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
  const located = useMemo(() => (index ? index.locate(query) : 0), [index, query])

  // 点出来的那一行记下行号：locate 只认词头，而同一个词头在词库里可能占好几行
  //（读音不同，如「表」ひょう / おもて），只按词头找会高亮到其中的第一行去。
  // 换索引（cacheKey 变）或输入变成别的词，这份记录就失效。
  const [picked, setPicked] = useState<{ key: string; word: string; line: number } | null>(
    null,
  )
  const isPicked = picked?.key === cacheKey && picked.word === query.trim()
  const activeLine = isPicked ? picked.line : located

  useEffect(() => {
    // 点出来的行本来就在眼前，再滚一次等于把列表从鼠标底下抽走。
    if (isPicked) return
    scrollRef.current?.scrollTo({ top: activeLine * ROW_HEIGHT })
  }, [activeLine, isPicked])

  const total = index?.size ?? 0
  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  const last = Math.min(total, Math.ceil((scrollTop + viewport) / ROW_HEIGHT) + OVERSCAN)
  const visible = index ? index.rows.slice(first, last) : []

  // 只有日语词头表会同时有本地词库和我的单词库两种来源，其余索引里全部同源，
  // 行内再标来源就是废话。
  const showTags = withLocal && kind === 'ja-zh'

  return (
    <aside className="sticky top-4 hidden h-[calc(100vh-7rem)] w-[300px] shrink-0 flex-col gap-3 xl:flex">
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
                  onClick={() => {
                    setPicked({ key: cacheKey, word: row.word, line: row.line })
                    onPick(row)
                  }}
                  style={{ top: row.line * ROW_HEIGHT, height: ROW_HEIGHT }}
                  className={`absolute inset-x-0 flex items-center gap-2 px-3 text-left transition-colors duration-100 ${
                    row.line === activeLine
                      ? 'bg-accent/10 hover:bg-accent/15'
                      : 'hover:bg-accent/6'
                  }`}
                >
                  <span className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
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
                  </span>
                  {/* 行尾靠右是这个词自身的属性：JLPT 级别，以及入过词单
                      （非纯本地行）时亮的那颗星。和词头旁边的来源标签分开放，
                      免得「本地 / AI」和「N2」看起来像同一类东西。 */}
                  <JlptChips levels={jlptLevels(row.word)} />
                  {row.source !== 'local' ? (
                    <Star className="size-3.5 shrink-0 fill-gold text-gold" aria-hidden />
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
