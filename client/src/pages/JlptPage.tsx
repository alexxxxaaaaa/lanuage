import { useEffect, useMemo, useState } from 'react'
import { Button, Chip, EmptyState, Spinner, Table, toast, type Selection } from '@heroui/react'
import { ChevronRight } from 'lucide-react'
import { Link } from 'react-router'
import { SegmentedControl } from '../components/ui/SegmentedControl'
import { TabsView } from '../components/ui/TabsView'
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
import { CATEGORIES, categoryLabel, mondaiLabel, mondaiMeta, paperLabel } from './jlpt/constants'
import { ExamPaperList } from './jlpt/ExamPaperList'
import {
  ACTION_LINK,
  CELL_ACTIONS,
  CELL_MAIN,
  CELL_NUM,
  CELL_SUB,
  TABLE_DENSE,
} from './jlpt/styles'

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

/** 精练目录的一行。題型行带 children（历年卷次），卷次行的 children 是空的。 */
type PracticeNode = {
  id: string
  label: string
  /** 題型名。卷次行没有第二行。 */
  sub?: string
  answered: number
  total: number
  href: string
  children: PracticeNode[]
}

function toNodes(groups: QbankOverviewGroup[]): PracticeNode[] {
  return groups.map((g) => ({
    id: `${g.category}-${g.mondaiNo}`,
    // tab 上已经写着是哪个大类，行里只留「問題N」——
    // mondaiLabel 给听力加的「聴解」前缀在这儿是重复的。
    label: `問題${g.mondaiNo}`,
    sub: mondaiMeta(g.category, g.mondaiNo).type,
    answered: g.answered,
    total: g.total,
    href: practiceHref({ category: g.category, mondaiNo: g.mondaiNo }),
    children: g.papers.map((p) => ({
      id: `${g.category}-${g.mondaiNo}-${p.year}-${p.month}`,
      label: paperLabel(p.year, p.month),
      answered: p.answered,
      total: p.total,
      href: practiceHref({
        category: g.category,
        mondaiNo: g.mondaiNo,
        year: p.year,
        month: p.month,
      }),
      children: [],
    })),
  }))
}

/**
 * 一个大类（词汇 / 语法 / 阅读 / 听力）的精练目录。
 *
 * 題型和它下面的历年卷次是同一种行，只是层级不同 —— 所以两级共用一个
 * `renderRow`，靠 <Table.Collection> 递归下去，展开态由表格自己管。
 */
function PracticeTable({ groups }: { groups: QbankOverviewGroup[] }) {
  const [expandedKeys, setExpandedKeys] = useState<Selection>(() => new Set())
  const items = useMemo(() => toNodes(groups), [groups])

  const renderRow = (node: PracticeNode) => (
    <Table.Row id={node.id} key={node.id} textValue={node.label}>
      <Table.Cell textValue={node.label}>
        {({ hasChildItems, isExpanded, isTreeColumn }) => (
          <div className="flex items-center gap-1.5">
            {isTreeColumn ? (
              hasChildItems ? (
                <Button
                  isIconOnly
                  aria-label="展开卷次"
                  size="sm"
                  slot="chevron"
                  variant="ghost"
                >
                  <ChevronRight
                    aria-hidden
                    className={`size-4 text-muted transition-transform ${
                      isExpanded ? 'rotate-90' : ''
                    }`}
                  />
                </Button>
              ) : (
                /* 补一格展开钮的位置：树自带的缩进只有 16px，不补的话卷次行的
                   文字反而比題型行还靠左，层级就看反了。 */
                <span aria-hidden className="w-9 shrink-0 md:w-8" />
              )
            ) : null}
            <div>
              <div className={CELL_MAIN}>{node.label}</div>
              {node.sub ? <div className={CELL_SUB}>{node.sub}</div> : null}
            </div>
          </div>
        )}
      </Table.Cell>
      <Table.Cell className={CELL_NUM}>
        {node.answered} / {node.total}
      </Table.Cell>
      <Table.Cell>
        <div className={CELL_ACTIONS}>
          <Link className={ACTION_LINK} to={node.href}>
            练习
          </Link>
        </div>
      </Table.Cell>
      <Table.Collection items={node.children}>{renderRow}</Table.Collection>
    </Table.Row>
  )

  return (
    <Table>
      <Table.ScrollContainer>
        <Table.Content
          aria-label="精练目录"
          className={TABLE_DENSE}
          expandedKeys={expandedKeys}
          treeColumn="mondai"
          onExpandedChange={setExpandedKeys}
        >
          <Table.Header>
            <Table.Column id="mondai" isRowHeader>
              題型
            </Table.Column>
            <Table.Column id="progress">已答</Table.Column>
            <Table.Column className="text-end" id="actions">
              操作
            </Table.Column>
          </Table.Header>
          <Table.Body
            items={items}
            renderEmptyState={() => (
              <EmptyState className="px-4 py-10 text-center text-sm text-muted">
                这个大类还没导入题目。
              </EmptyState>
            )}
          >
            {renderRow}
          </Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
    </Table>
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
    let ignore = false
    async function loadGroups() {
      setIsLoading(true)
      try {
        const { items } = await getQbankSet({ scope })
        if (ignore) return
        const byGroup = new Map<string, { category: string; mondaiNo: number; count: number }>()
        for (const item of items) {
          const key = `${item.category}-${item.mondaiNo}`
          const hit = byGroup.get(key)
          if (hit) hit.count += 1
          else byGroup.set(key, { category: item.category, mondaiNo: item.mondaiNo, count: 1 })
        }
        setGroups([...byGroup.values()])
      } catch (e) {
        if (!ignore) toast.danger(getErrorMessage(e, '加载失败'))
      } finally {
        if (!ignore) setIsLoading(false)
      }
    }
    void loadGroups()
    return () => {
      ignore = true
    }
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
          <Link className="button button--primary button--sm shrink-0" to={practiceHref({ scope })}>
            全部练习（{total}）
          </Link>
        ) : null}
      </div>

      <Table>
        <Table.ScrollContainer>
          <Table.Content aria-label={scope === 'favorite' ? '收藏的题' : '错题'} className={TABLE_DENSE}>
            <Table.Header>
              <Table.Column isRowHeader>題型</Table.Column>
              <Table.Column>题数</Table.Column>
              <Table.Column className="text-end">操作</Table.Column>
            </Table.Header>
            <Table.Body
              renderEmptyState={() => (
                <EmptyState className="px-4 py-10 text-center text-sm text-muted">
                  {isLoading
                    ? '加载中…'
                    : scope === 'favorite'
                      ? '还没有收藏的题。做题时点题目下面的星标就能收进来。'
                      : '还没有错题——答错的题会自动进这里，答对后自动移出。'}
                </EmptyState>
              )}
            >
              {(isLoading ? [] : (groups ?? [])).map((g) => {
                const key = `${g.category}-${g.mondaiNo}`
                return (
                  <Table.Row id={key} key={key} textValue={mondaiLabel(g.category, g.mondaiNo)}>
                    <Table.Cell>
                      <div className={CELL_MAIN}>{mondaiLabel(g.category, g.mondaiNo)}</div>
                      <div className={CELL_SUB}>
                        {categoryLabel(g.category)} · {mondaiMeta(g.category, g.mondaiNo).type}
                      </div>
                    </Table.Cell>
                    <Table.Cell className={CELL_NUM}>{g.count}</Table.Cell>
                    <Table.Cell>
                      <div className={CELL_ACTIONS}>
                        <Link
                          className={ACTION_LINK}
                          to={practiceHref({ category: g.category, mondaiNo: g.mondaiNo, scope })}
                        >
                          练习
                        </Link>
                      </div>
                    </Table.Cell>
                  </Table.Row>
                )
              })}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>
    </div>
  )
}

/**
 * JLPT：第一个 tab 是整卷模拟考试，其余是「大类（词汇/语法/阅读/听力）→ 題型
 * → 年份」三级精练目录，每一级都能直接开练，題型级是「该題型全部年份连着做」。
 */
export function JlptPage() {
  const isActive = usePageActive()
  const [overview, setOverview] = useState<QbankOverview | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [tab, setTab] = useState<string>('mock')

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
          <h2>N1 题库</h2>
          <p className="muted">
            2010–2025 共 31 套真题。整卷计时考是「模拟考试」，单题精练按題型和年份来 ——
            精练选完选项立刻出答案和解析，做过的题记在答题卡里。
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
          <div className="-mt-2 flex flex-wrap gap-1.5">
            <Chip>全库 {totalQuestions} 题</Chip>
            <Chip color="accent" variant="soft">
              已做 {totalAnswered}
            </Chip>
            {overview.wrongCount > 0 ? (
              <Chip color="danger" variant="soft">
                错题 {overview.wrongCount}
              </Chip>
            ) : null}
            {overview.favoriteCount > 0 ? (
              <Chip color="warning" variant="soft">
                收藏 {overview.favoriteCount}
              </Chip>
            ) : null}
          </div>
          <TabsView
            activeKey={tab}
            onChange={setTab}
            // 6 个 tab 要在手机上一屏放下：收窄内边距、缩一号字。日文分区名
            // （文字・語彙 等）只在 ≥md 显示 —— 中文短标签已经足够辨认。
            // 超出时 Tabs.ListContainer 自带横向滑动 + 渐隐箭头兜底。
            className="max-md:**:data-[slot=tabs-tab]:px-2 max-md:**:data-[slot=tabs-tab]:text-[13px]"
            items={[
              { key: 'mock', label: '模拟考试', children: <ExamPaperList /> },
              ...CATEGORIES.map((c) => ({
                key: c.key,
                label: (
                  <>
                    {c.label}
                    <span className="max-md:hidden"> {c.section}</span>
                  </>
                ),
                children: <PracticeTable groups={byCategory.get(c.key) ?? []} />,
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
