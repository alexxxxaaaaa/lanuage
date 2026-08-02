import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Segmented, Spin, Tabs, message } from 'antd'
import { DownOutlined, RightOutlined } from '@ant-design/icons'
import {
  getQbankOverview,
  getQbankSet,
  type QbankOverview,
  type QbankOverviewGroup,
  type QbankScope,
  type QbankSetFilter,
} from '../api/qbank'
import { getErrorMessage } from '../api/error'
import { useTab } from '../components/TabContext'
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
    <div className="jlpt-progress" title={total ? `已答 ${answered} · 正确 ${correct}` : ''}>
      <div className="jlpt-progress-bar">
        <span className="jlpt-progress-answered" style={{ width: pct(answered) }} />
        <span className="jlpt-progress-correct" style={{ width: pct(correct) }} />
      </div>
      <span className="jlpt-progress-count">
        {answered}/{total}
      </span>
    </div>
  )
}

function GroupRow({ group }: { group: QbankOverviewGroup }) {
  const [open, setOpen] = useState(false)
  const meta = mondaiMeta(group.category, group.mondaiNo)

  return (
    <li className="jlpt-group">
      <div className="jlpt-row jlpt-row-group">
        <button
          type="button"
          className="jlpt-row-toggle"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          {open ? <DownOutlined /> : <RightOutlined />}
          <span className="jlpt-row-chapter">{mondaiLabel(group.category, group.mondaiNo)}</span>
        </button>
        <div className="jlpt-row-main">
          <p className="jlpt-row-title">{meta.type}</p>
          <p className="jlpt-row-instruction">{meta.instruction}</p>
        </div>
        <Progress total={group.total} answered={group.answered} correct={group.correct} />
        <Link
          className="jlpt-practice-button"
          to={practiceHref({ category: group.category, mondaiNo: group.mondaiNo })}
        >
          练习
        </Link>
      </div>

      {open ? (
        <ul className="jlpt-paper-list">
          {group.papers.map((p) => (
            <li className="jlpt-row jlpt-row-paper" key={`${p.year}-${p.month}`}>
              <span className="jlpt-row-chapter jlpt-row-chapter-sub">
                {paperLabel(p.year, p.month)}
              </span>
              <div className="jlpt-row-main">
                <p className="jlpt-row-title">{paperLabel(p.year, p.month)}新日本語能力試験</p>
              </div>
              <Progress total={p.total} answered={p.answered} correct={p.correct} />
              <Link
                className="jlpt-practice-button"
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
      .catch((e) => message.error(getErrorMessage(e, '加载失败')))
      .finally(() => setIsLoading(false))
  }, [scope, overview])

  const total = groups?.reduce((sum, g) => sum + g.count, 0) ?? 0

  return (
    <div className="jlpt-marked">
      <div className="jlpt-marked-head">
        <Segmented
          value={scope}
          onChange={(v) => setScope(v as 'favorite' | 'wrong')}
          options={[
            { label: `收藏 ${overview.favoriteCount}`, value: 'favorite' },
            { label: `错题 ${overview.wrongCount}`, value: 'wrong' },
          ]}
        />
        {total > 0 ? (
          <Link className="jlpt-practice-button is-primary" to={practiceHref({ scope })}>
            全部练习（{total}）
          </Link>
        ) : null}
      </div>

      {isLoading ? (
        <div className="jlpt-loading">
          <Spin />
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
        <ul className="jlpt-list">
          {groups!.map((g) => (
            <li className="jlpt-row jlpt-row-group" key={`${g.category}-${g.mondaiNo}`}>
              <span className="jlpt-row-chapter">{categoryLabel(g.category)}</span>
              <div className="jlpt-row-main">
                <p className="jlpt-row-title">
                  {mondaiLabel(g.category, g.mondaiNo)} {mondaiMeta(g.category, g.mondaiNo).type}
                </p>
              </div>
              <span className="jlpt-row-count">{g.count} 题</span>
              <Link
                className="jlpt-practice-button"
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
  const { isActive } = useTab()
  const [overview, setOverview] = useState<QbankOverview | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [tab, setTab] = useState<TabKey>('vocab')

  // 每次切回这个 tab 都重拉一次进度：练习页是另一个 tab，做完题回来
  // 这边的树是 keep-alive 挂着的，不刷新就一直显示旧的 x/y。
  useEffect(() => {
    if (!isActive) return
    getQbankOverview()
      .then(setOverview)
      .catch((e) => message.error(getErrorMessage(e, '加载题库失败')))
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
    <section className="page jlpt-page">
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
        <div className="jlpt-loading">
          <Spin />
        </div>
      ) : !overview ? (
        <div className="card state-card">
          <p className="muted">题库还没导入。</p>
        </div>
      ) : (
        <>
          <p className="muted jlpt-summary">
            全库 {totalQuestions} 题，已做 {totalAnswered} 题
            {overview.wrongCount > 0 ? ` · 错题 ${overview.wrongCount}` : ''}
            {overview.favoriteCount > 0 ? ` · 收藏 ${overview.favoriteCount}` : ''}
          </p>
          <Tabs
            className="jlpt-tabs"
            activeKey={tab}
            onChange={setTab}
            items={[
              ...CATEGORIES.map((c) => ({
                key: c.key,
                label: `${c.label} ${c.section}`,
                children: (
                  <ul className="jlpt-list">
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
