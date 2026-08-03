import { useEffect, useMemo, useRef, useState } from 'react'
import { ListBox, ListLayout, Spinner, Tabs, Virtualizer } from '@heroui/react'
import { DictIndex, type DictDirection, type IndexRow } from '../lib/dictIndex'
import { useI18n } from '../i18n'

/** 和 ListLayout 的 rowHeight 保持一致 —— 定位靠 line * ROW_HEIGHT 直接算滚动位置。 */
const ROW_HEIGHT = 52

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
 */
export function DictIndexPanel({ query, onPick }: Props) {
  const { t } = useI18n()
  const [direction, setDirection] = useState<DictDirection>('ja-zh')
  const [index, setIndex] = useState<DictIndex | null>(null)
  const [failed, setFailed] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

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

  // 定位是纯计算，直接从 index + query 派生。二分查找十几次比较，
  // 但按词头查那条路首次会排一次序，所以仍然 memo 住。
  const activeLine = useMemo(() => (index ? index.locate(query) : 0), [index, query])

  // 行高固定，滚动位置直接算得出来，不用问虚拟列表要。
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: activeLine * ROW_HEIGHT })
  }, [activeLine])

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
          <Virtualizer layout={ListLayout} layoutOptions={{ rowHeight: ROW_HEIGHT }}>
            <ListBox
              aria-label={t('wordSearch.indexTitle')}
              className="h-full w-full overflow-y-auto"
              items={index.rows}
              selectionMode="none"
              onAction={(key) => onPick(index.rows[Number(key)])}
              render={(props) => <div {...props} ref={scrollRef} />}
            >
              {(row: IndexRow) => (
                <ListBox.Item
                  id={row.line}
                  textValue={row.word}
                  className={
                    row.line === activeLine
                      ? 'rounded-lg bg-accent/10 data-[hovered=true]:bg-accent/15'
                      : 'rounded-lg data-[hovered=true]:bg-accent/6'
                  }
                >
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-[15px] text-foreground">{row.word}</span>
                    {row.reading ? (
                      <span className="muted truncate text-[12px]">{row.reading}</span>
                    ) : null}
                  </div>
                </ListBox.Item>
              )}
            </ListBox>
          </Virtualizer>
        )}
      </div>

      <p className="muted m-0 text-[12px]">{t('wordSearch.indexHint')}</p>
    </aside>
  )
}
