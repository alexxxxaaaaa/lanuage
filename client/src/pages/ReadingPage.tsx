import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { message } from 'antd'
import { listExams } from '../api/exams'
import { getErrorMessage } from '../api/error'
import type { ExamListItem } from '../types'

const READING_PREFIX = '精读·'

type ReadingItem = {
  exam: ExamListItem
  source: string // 来源真题,如 "2011.7"
  order: number // 篇内序号,用于排序
  label: string // 如 "問題9(1)"
}

/** Parse a reading-piece title "精读·2011.12·05 問題9(1)" into its parts.
 *  Reading pieces are stored as Exam rows tagged with the 精读· prefix so they
 *  reuse the whole exam take/score/explanation flow; this page just lists them
 *  grouped by source exam. */
function parseReading(exam: ExamListItem): ReadingItem | null {
  if (!exam.title.startsWith(READING_PREFIX)) return null
  const parts = exam.title.split('·')
  const source = parts[1] ?? ''
  const rest = parts[2] ?? ''
  const spaceIdx = rest.indexOf(' ')
  const order = Number(rest.slice(0, spaceIdx)) || 0
  const label = rest.slice(spaceIdx + 1) || rest
  return { exam, source, order, label }
}

/**
 * 精读板块:把真题里的每篇阅读拆成独立一篇,每天/隔天做一篇。每篇复用真题做题页
 * (原文 + 题目 + 答案 + 解析 + 计分),点开即做。
 */
export function ReadingPage() {
  const [exams, setExams] = useState<ExamListItem[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    void listExams()
      .then((rows) => setExams(rows))
      .catch((e) => message.error(getErrorMessage(e, '加载精读失败')))
      .finally(() => setIsLoading(false))
  }, [])

  const groups = useMemo(() => {
    const items = exams
      .map(parseReading)
      .filter((x): x is ReadingItem => x !== null)
    const bySource = new Map<string, ReadingItem[]>()
    for (const it of items) {
      const arr = bySource.get(it.source) ?? []
      arr.push(it)
      bySource.set(it.source, arr)
    }
    return [...bySource.entries()]
      .map(([source, arr]) => ({
        source,
        items: arr.sort((a, b) => a.order - b.order),
      }))
      .sort((a, b) => a.source.localeCompare(b.source))
  }, [exams])

  return (
    <section className="page">
      <div className="section-header">
        <div>
          <p className="eyebrow">N1 読解</p>
          <h2>精读</h2>
          <p className="muted">
            真题阅读拆成独立一篇,每天做一篇。点开即做,含答案与解析。
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="card state-card">
          <p className="muted">加载中…</p>
        </div>
      ) : groups.length === 0 ? (
        <div className="card state-card">
          <h3>还没有精读篇目</h3>
          <p className="muted">拆分好的阅读会显示在这里。</p>
        </div>
      ) : (
        groups.map((g) => (
          <div key={g.source} className="reading-group">
            <p className="eyebrow reading-group-title">{g.source} 真题</p>
            <ul className="exam-list">
              {g.items.map((it) => (
                <li key={it.exam.id} className="card exam-card">
                  <Link className="exam-card-body" to={`/exams/${it.exam.id}`}>
                    <div className="exam-card-title">
                      <strong>{it.label}</strong>
                      <span className="tag-inline">{it.exam.level}</span>
                    </div>
                    <p className="muted exam-card-meta">
                      {g.source} · 第 {it.order} 篇
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  )
}
