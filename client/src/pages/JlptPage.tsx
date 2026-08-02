import { useEffect, useMemo, useState } from 'react'
import { Button, Card, Chip, Disclosure, ProgressCircle, Spinner, toast } from '@heroui/react'
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
import { ROW, ROW_LABEL, ROW_LINK as PRACTICE_LINK, ROW_MAIN, ROW_TITLE } from './jlpt/styles'

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

/** 一行进度：小圆环是已答 / 总数，做对多少写在旁边的数字里。 */
function Progress({ total, answered, correct }: { total: number; answered: number; correct: number }) {
  return (
    <div className="flex w-[160px] shrink-0 items-center justify-end gap-2 max-[900px]:w-auto max-[900px]:flex-1">
      <ProgressCircle aria-label="作答进度" maxValue={Math.max(total, 1)} size="sm" value={answered}>
        <ProgressCircle.Track>
          <ProgressCircle.TrackCircle />
          <ProgressCircle.FillCircle />
        </ProgressCircle.Track>
      </ProgressCircle>
      <span className="text-xs tabular-nums text-muted">
        {answered}/{total}
        {answered > 0 ? ` · 正确 ${correct}` : ''}
      </span>
    </div>
  )
}

function GroupRow({ group }: { group: QbankOverviewGroup }) {
  const meta = mondaiMeta(group.category, group.mondaiNo)

  return (
    <Card<'li'> className="gap-0 overflow-hidden p-0" render={(props) => <li {...props} />}>
      <Disclosure>
        {/* 只有題型标签那一块是折叠触发器：练习入口和进度得留在按钮外面才点得到。 */}
        <div className={`${ROW} bg-accent/5`}>
          <Button
            className={`${ROW_LABEL} justify-start gap-1.5 px-2`}
            size="sm"
            slot="trigger"
            variant="ghost"
          >
            {mondaiLabel(group.category, group.mondaiNo)}
            <Disclosure.Indicator />
          </Button>
          <div className={ROW_MAIN}>
            <p className={ROW_TITLE}>{meta.type}</p>
            <p className="mt-0.5 mb-0 line-clamp-2 text-xs/[1.5] text-muted max-[900px]:line-clamp-3">
              {meta.instruction}
            </p>
          </div>
          <Progress total={group.total} answered={group.answered} correct={group.correct} />
          <Link
            className={PRACTICE_LINK}
            to={practiceHref({ category: group.category, mondaiNo: group.mondaiNo })}
          >
            练习
          </Link>
        </div>

        <Disclosure.Content>
          <ul className="m-0 list-none border-t border-border p-0">
            {group.papers.map((p) => (
              <li
                className={`${ROW} [&:not(:first-child)]:border-t [&:not(:first-child)]:border-separator`}
                key={`${p.year}-${p.month}`}
              >
                <span className={`${ROW_LABEL} pl-5`}>{paperLabel(p.year, p.month)}</span>
                <div className={ROW_MAIN}>
                  <p className={ROW_TITLE}>新日本語能力試験</p>
                </div>
                <Progress total={p.total} answered={p.answered} correct={p.correct} />
                <Link
                  className={PRACTICE_LINK}
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
        </Disclosure.Content>
      </Disclosure>
    </Card>
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

      {isLoading ? (
        <div className="grid place-items-center py-12">
          <Spinner />
        </div>
      ) : total === 0 ? (
        <div className="card state-card">
          <p className="muted">
            {scope === 'favorite'
              ? '还没有收藏的题。做题时点题目下面的星标就能收进来。'
              : '还没有错题——答错的题会自动进这里，答对后自动移出。'}
          </p>
        </div>
      ) : (
        <ul className="m-0 grid list-none gap-2 p-0">
          {groups!.map((g) => (
            <li
              className={`${ROW} rounded-[14px] border border-border bg-accent/5`}
              key={`${g.category}-${g.mondaiNo}`}
            >
              <span className={ROW_LABEL}>{categoryLabel(g.category)}</span>
              <div className={ROW_MAIN}>
                <p className={ROW_TITLE}>
                  {mondaiLabel(g.category, g.mondaiNo)} {mondaiMeta(g.category, g.mondaiNo).type}
                </p>
              </div>
              <Chip>{g.count} 题</Chip>
              <Link
                className={PRACTICE_LINK}
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
            items={[
              { key: 'mock', label: '模拟考试', children: <ExamPaperList /> },
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
