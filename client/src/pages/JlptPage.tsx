import { useEffect, useMemo, useState } from 'react'
import { Spinner, toast } from '@heroui/react'
import { Link } from 'react-router'
import { SegmentedControl } from '../components/ui/SegmentedControl'
import { TabsView } from '../components/ui/TabsView'
import { ChevronDown, ChevronRight } from 'lucide-react'
import {
  getQbankOverview,
  getQbankSet,
  type QbankOverview,
  type QbankOverviewGroup,
  type QbankScope,
  type QbankSetFilter,
} from '../api/qbank'
import { getErrorMessage } from '../api/error'
import { usePageActive } from '../components/layout/pageContext'
import {
  CATEGORIES,
  categoryLabel,
  mondaiLabel,
  mondaiMeta,
  paperLabel,
} from './jlpt/constants'

type TabKey = string

function practiceHref(filter: QbankSetFilter): string {
  const params = new URLSearchParams()
  if (filter.category) params.set('category', filter.category)
  if (filter.mondaiNo) params.set('mondaiNo', String(filter.mondaiNo))
  if (filter.year && filter.month) {
    params.set('year', String(filter.year))
    params.set('month', String(filter.month))
  }
  if (filter.scope && filter.scope !== 'all') params.set('scope', filter.scope)
  return `/jlpt/practice?${params.toString()}`
}

/** 一行进度：已答 / 总数 + 细进度条，做对的部分是绿的。 */
function Progress({ total, answered, correct }: { total: number; answered: number; correct: number }) {
  const pct = (n: number) => (total > 0 ? `${(n / total) * 100}%` : '0%')
  return (
    <div className="grid w-[180px] shrink-0 justify-items-end gap-1 max-[900px]:w-auto max-[900px]:flex-1" title={total ? `已答 ${answered} · 正确 ${correct}` : ''}>
      <div className="relative h-[3px] w-full overflow-hidden rounded-full bg-border">
        <span className="absolute inset-y-0 start-0 rounded-full bg-accent/45" style={{ width: pct(answered) }} />
        <span className="absolute inset-y-0 start-0 rounded-full bg-green-500" style={{ width: pct(correct) }} />
      </div>
      <span className="text-xs tabular-nums text-muted">
        {answered}/{total}
      </span>
    </div>
  )
}

function GroupRow({ group }: { group: QbankOverviewGroup }) {
  const [open, setOpen] = useState(false)
  const meta = mondaiMeta(group.category, group.mondaiNo)

  return (
    <li className="overflow-hidden rounded-[14px] border border-border bg-surface">
      <div className="flex items-center gap-3.5 px-4 py-3 max-[900px]:flex-wrap max-[900px]:gap-x-3 max-[900px]:gap-y-2 bg-accent/5">
        <button
          type="button"
          className="inline-flex min-h-0 cursor-pointer items-center gap-1.5 border-none bg-transparent p-0 text-[13px] font-semibold text-accent"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          {open ? <ChevronDown /> : <ChevronRight />}
          <span className="min-w-[68px] shrink-0 text-[13px] font-semibold text-accent">{mondaiLabel(group.category, group.mondaiNo)}</span>
        </button>
        <div className="min-w-0 flex-1 max-[900px]:order-3 max-[900px]:basis-full">
          <p className="m-0 text-sm font-semibold text-foreground">{meta.type}</p>
          <p className="mt-0.5 mb-0 line-clamp-2 text-xs/[1.5] text-muted max-[900px]:line-clamp-3">{meta.instruction}</p>
        </div>
        <Progress total={group.total} answered={group.answered} correct={group.correct} />
        <Link
          className="shrink-0 rounded-full border border-accent bg-surface px-3.5 py-[5px] text-[13px] font-semibold whitespace-nowrap text-accent hover:bg-accent hover:text-white"
          to={practiceHref({ category: group.category, mondaiNo: group.mondaiNo })}
        >
          练习
        </Link>
      </div>

      {open ? (
        <ul className="m-0 list-none border-t border-border p-0">
          {group.papers.map((p) => (
            <li className="flex items-center gap-3.5 px-4 py-3 max-[900px]:flex-wrap max-[900px]:gap-x-3 max-[900px]:gap-y-2 [&:not(:first-child)]:border-t [&:not(:first-child)]:border-dashed [&:not(:first-child)]:border-border" key={`${p.year}-${p.month}`}>
              <span className="min-w-[68px] shrink-0 text-[13px] font-semibold text-accent pl-5">
                {paperLabel(p.year, p.month)}
              </span>
              <div className="min-w-0 flex-1 max-[900px]:order-3 max-[900px]:basis-full">
                <p className="m-0 text-sm font-semibold text-foreground">{paperLabel(p.year, p.month)}新日本語能力試験</p>
              </div>
              <Progress total={p.total} answered={p.answered} correct={p.correct} />
              <Link
                className="shrink-0 rounded-full border border-accent bg-surface px-3.5 py-[5px] text-[13px] font-semibold whitespace-nowrap text-accent hover:bg-accent hover:text-white"
                to={practiceHref({
                  category: group.category,
                  mondaiNo: group.mondaiNo,
                  year: p.year,
                  month: p.month,
                })}
              >
                练习
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  )
}

/** 收藏 / 错题：题目不按考卷排，只按題型聚合，好挑着重练。 */
function MarkedPanel({ overview }: { overview: QbankOverview }) {
  const [scope, setScope] = useState<Exclude<QbankScope, 'all'>>('favorite')
  const [groups, setGroups] = useState<Array<{ category: string; mondaiNo: number; count: number }> | null>(
    null,
  )
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    setIsLoading(true)
    getQbankSet({ scope })
      .then(({ items }) => {
        const byGroup = new Map<string, { category: string; mondaiNo: number; count: number }>()
        for (const item of items) {
          const key = `${item.category}-${item.mondaiNo}`
          const hit = byGroup.get(key)
          if (hit) hit.count += 1
          else byGroup.set(key, { category: item.category, mondaiNo: item.mondaiNo, count: 1 })
        }
        setGroups([...byGroup.values()])
      })
      .catch((e) => toast.danger(getErrorMessage(e, '加载失败')))
      .finally(() => setIsLoading(false))
  }, [scope, overview])

  const total = groups?.reduce((sum, g) => sum + g.count, 0) ?? 0

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <SegmentedControl
          value={scope}
          onChange={(v) => setScope(v as 'favorite' | 'wrong')}
          options={[
            { label: `收藏 ${overview.favoriteCount}`, value: 'favorite' },
            { label: `错题 ${overview.wrongCount}`, value: 'wrong' },
          ]}
        />
        {total > 0 ? (
          <Link className="shrink-0 rounded-full border border-accent bg-surface px-3.5 py-[5px] text-[13px] font-semibold whitespace-nowrap text-accent hover:bg-accent hover:text-white bg-accent text-white" to={practiceHref({ scope })}>
            全部练习（{total}）
          </Link>
        ) : null}
      </div>

      {isLoading ? (
        <div className="grid place-items-center py-12">
          <Spinner />
        </div>
      ) : total === 0 ? (
        <div className="card state-card">
          <p className="muted">
            {scope === 'favorite'
              ? '还没有收藏的题。做题时点右上角的星标就能收进来。'
              : '还没有错题——答错的题会自动进这里，答对后自动移出。'}
          </p>
        </div>
      ) : (
        <ul className="m-0 grid list-none gap-2 p-0">
          {groups!.map((g) => (
            <li className="flex items-center gap-3.5 px-4 py-3 max-[900px]:flex-wrap max-[900px]:gap-x-3 max-[900px]:gap-y-2 rounded-[14px] border border-border bg-accent/5" key={`${g.category}-${g.mondaiNo}`}>
              <span className="min-w-[68px] shrink-0 text-[13px] font-semibold text-accent">{categoryLabel(g.category)}</span>
              <div className="min-w-0 flex-1 max-[900px]:order-3 max-[900px]:basis-full">
                <p className="m-0 text-sm font-semibold text-foreground">
                  {mondaiLabel(g.category, g.mondaiNo)} {mondaiMeta(g.category, g.mondaiNo).type}
                </p>
              </div>
              <span className="shrink-0 text-[13px] text-muted">{g.count} 题</span>
              <Link
                className="shrink-0 rounded-full border border-accent bg-surface px-3.5 py-[5px] text-[13px] font-semibold whitespace-nowrap text-accent hover:bg-accent hover:text-white"
                to={practiceHref({ category: g.category, mondaiNo: g.mondaiNo, scope })}
              >
                练习
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * JLPT 精练：大类（词汇/语法/阅读/听力/收藏）→ 題型 → 年份 三级目录。
 * 每一级都能直接开练，題型级是「该題型全部年份连着做」。
 */
export function JlptPage() {
  const isActive = usePageActive()
  const [overview, setOverview] = useState<QbankOverview | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [tab, setTab] = useState<TabKey>('vocab')

  // 每次切回这个 tab 都重拉一次进度：练习页是另一个 tab，做完题回来
  // 这边的树是 keep-alive 挂着的，不刷新就一直显示旧的 x/y。
  useEffect(() => {
    if (!isActive) return
    getQbankOverview()
      .then(setOverview)
      .catch((e) => toast.danger(getErrorMessage(e, '加载题库失败')))
      .finally(() => setIsLoading(false))
  }, [isActive])

  const byCategory = useMemo(() => {
    const map = new Map<string, QbankOverviewGroup[]>()
    for (const g of overview?.groups ?? []) {
      const list = map.get(g.category)
      if (list) list.push(g)
      else map.set(g.category, [g])
    }
    for (const list of map.values()) list.sort((a, b) => a.mondaiNo - b.mondaiNo)
    return map
  }, [overview])

  const totalAnswered = overview?.groups.reduce((s, g) => s + g.answered, 0) ?? 0
  const totalQuestions = overview?.groups.reduce((s, g) => s + g.total, 0) ?? 0

  return (
    <section className="page">
      <div className="section-header">
        <div>
          <p className="eyebrow">JLPT 精练</p>
          <h2>N1 分类精练</h2>
          <p className="muted">
            2010–2025 共 31 套真题拆成单题，按題型和年份练。选完选项立刻出答案和解析，
            做过的题会记在答题卡里。
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="grid place-items-center py-12">
          <Spinner />
        </div>
      ) : !overview ? (
        <div className="card state-card">
          <p className="muted">题库还没导入。</p>
        </div>
      ) : (
        <>
          <p className="muted -mt-2 mb-0 text-[13px]">
            全库 {totalQuestions} 题，已做 {totalAnswered} 题
            {overview.wrongCount > 0 ? ` · 错题 ${overview.wrongCount}` : ''}
            {overview.favoriteCount > 0 ? ` · 收藏 ${overview.favoriteCount}` : ''}
          </p>
          <TabsView
            activeKey={tab}
            onChange={setTab}
            items={[
              ...CATEGORIES.map((c) => ({
                key: c.key,
                label: `${c.label} ${c.section}`,
                children: (
                  <ul className="m-0 grid list-none gap-2 p-0">
                    {(byCategory.get(c.key) ?? []).map((g) => (
                      <GroupRow group={g} key={`${g.category}-${g.mondaiNo}`} />
                    ))}
                  </ul>
                ),
              })),
              {
                key: 'marked',
                label: '收藏 / 错题',
                children: <MarkedPanel overview={overview} />,
              },
            ]}
          />
        </>
      )}
    </section>
  )
}
