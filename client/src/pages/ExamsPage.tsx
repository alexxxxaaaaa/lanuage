import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { message } from 'antd'
import { listExams } from '../api/exams'
import { getErrorMessage } from '../api/error'
import type { ExamListItem } from '../types'

function formatDate(iso: string) {
  const d = new Date(iso)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Read-only exam library for regular users. Uploads happen in the separate
 * admin panel (language-admin) — this page just shows the shared library
 * and lets users open a real-exam session.
 */
export function ExamsPage() {
  const [exams, setExams] = useState<ExamListItem[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    void listExams()
      // 精读拆篇也存成 Exam(标题以「精读·」开头),它们归精读板块,真题库里排除。
      .then((rows) => setExams(rows.filter((r) => !r.title.startsWith('精读·'))))
      .catch((e) => message.error(getErrorMessage(e, '加载真题失败')))
      .finally(() => setIsLoading(false))
  }, [])

  return (
    <section className="page">
      <div className="section-header">
        <div>
          <p className="eyebrow">JLPT 真题</p>
          <h2>真题</h2>
          <p className="muted">
            共享真题库。点开一份开始刷题;每次答题记录只属于你自己。
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="card state-card">
          <p className="muted">加载中…</p>
        </div>
      ) : exams.length === 0 ? (
        <div className="card state-card">
          <h3>还没有真题</h3>
          <p className="muted">管理员还没有上传过真题,过几天再来看看。</p>
        </div>
      ) : (
        <ul className="exam-list">
          {exams.map((ex) => (
            <li key={ex.id} className="card exam-card">
              <Link className="exam-card-body" to={`/exams/${ex.id}`}>
                <div className="exam-card-title">
                  <strong>{ex.title}</strong>
                  <span className="tag-inline">{ex.level}</span>
                </div>
                <p className="muted exam-card-meta">
                  {ex.year ? `${ex.year} · ` : ''}上传于 {formatDate(ex.createdAt)}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
