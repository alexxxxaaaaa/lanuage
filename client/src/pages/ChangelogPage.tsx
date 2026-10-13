import { useMemo } from 'react'
import { CHANGELOG } from '../generated/changelog'

/**
 * 更新历史。
 *
 * 数据来自 src/generated/changelog.ts —— 由 scripts/genChangelog.mjs 从 git log
 * 生成并提交进仓库（不在构建时现跑，理由见那个脚本的注释）。所以这一页显示的
 * 是「代码写于何时」；顶上的构建时间才是「这一版何时上线」，两者可以差几天。
 */

function daysBetween(from: Date, to: Date): number {
  const startOfDay = (d: Date) => {
    const x = new Date(d)
    x.setHours(0, 0, 0, 0)
    return x.getTime()
  }
  return Math.round((startOfDay(to) - startOfDay(from)) / 86_400_000)
}

function relativeDay(days: number): string {
  if (days <= 0) return '今天'
  if (days === 1) return '昨天'
  if (days < 30) return `${days} 天前`
  const months = Math.floor(days / 30)
  return months < 12 ? `${months} 个月前` : `${Math.floor(days / 365)} 年前`
}

export function ChangelogPage() {
  const now = new Date()

  const buildTime = useMemo(() => {
    // dev 下 __BUILD_TIME__ 也有值（vite 启动的时刻），不特判。
    const parsed = new Date(__BUILD_TIME__)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }, [])

  const latest = CHANGELOG[0]
  const sinceLatest = latest ? daysBetween(new Date(latest.date), now) : null
  const totalChanges = CHANGELOG.reduce((sum, entry) => sum + entry.items.length, 0)

  return (
    <section className="page">
      <div className="section-header">
        <div>
          <h2>更新历史</h2>
          <p className="muted">
            最近 {CHANGELOG.length} 天有改动，共 {totalChanges} 条
          </p>
        </div>
      </div>

      <div className="card flex flex-wrap items-baseline gap-x-6 gap-y-2">
        {latest ? (
          <div>
            <div className="muted text-[13px]">最近一次改动</div>
            <div className="text-lg font-semibold">
              {relativeDay(sinceLatest ?? 0)}
              <span className="muted ml-2 text-[13px] font-normal">{latest.date}</span>
            </div>
          </div>
        ) : null}
        {buildTime ? (
          <div>
            <div className="muted text-[13px]">当前版本构建于</div>
            <div className="text-lg font-semibold">
              {relativeDay(daysBetween(buildTime, now))}
              <span className="muted ml-2 text-[13px] font-normal">
                {buildTime.toLocaleString('zh-CN', { hour12: false })}
              </span>
            </div>
          </div>
        ) : null}
      </div>

      <div className="mt-4 flex flex-col gap-5">
        {CHANGELOG.map((entry) => {
          const days = daysBetween(new Date(entry.date), now)
          return (
            <section key={entry.date}>
              <div className="mb-2 flex flex-wrap items-baseline gap-2">
                <h3 className="text-base font-semibold text-foreground">{entry.date}</h3>
                <span className="muted text-xs">{relativeDay(days)}</span>
                <span className="muted text-xs">· {entry.items.length} 条</span>
              </div>
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                {entry.items.map((item) => (
                  <li
                    key={item.sha}
                    className="flex gap-2 rounded-lg bg-surface px-3 py-2 text-[14px]/[1.6]"
                  >
                    <code className="muted shrink-0 font-mono text-xs leading-6">
                      {item.sha}
                    </code>
                    <span className="min-w-0">{item.subject}</span>
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
      </div>
    </section>
  )
}
