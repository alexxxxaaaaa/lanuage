import type { ReactNode } from 'react'
import { Pagination } from '@heroui/react'

// Page-number list with a leading/trailing ellipsis, matching the shape the
// word list needs. HeroUI ships the parts but leaves the windowing to us.

type PagerProps = {
  current: number
  pageSize: number
  total: number
  onChange: (page: number) => void
  summary?: ReactNode
}

/** 1 … 4 5 6 … 12 — always shows first/last plus a window around `current`. */
function pageWindow(current: number, totalPages: number): (number | 'gap')[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1)
  }
  const pages: (number | 'gap')[] = [1]
  if (current > 3) pages.push('gap')
  for (
    let i = Math.max(2, current - 1);
    i <= Math.min(totalPages - 1, current + 1);
    i++
  ) {
    pages.push(i)
  }
  if (current < totalPages - 2) pages.push('gap')
  pages.push(totalPages)
  return pages
}

export function Pager({ current, pageSize, total, onChange, summary }: PagerProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  if (totalPages <= 1) return null

  return (
    <Pagination className="w-full">
      {summary ? <Pagination.Summary>{summary}</Pagination.Summary> : null}
      <Pagination.Content>
        <Pagination.Item>
          <Pagination.Previous
            isDisabled={current === 1}
            onPress={() => onChange(current - 1)}
          >
            <Pagination.PreviousIcon />
          </Pagination.Previous>
        </Pagination.Item>
        {pageWindow(current, totalPages).map((p, i) =>
          p === 'gap' ? (
            <Pagination.Item key={`gap-${i}`}>
              <Pagination.Ellipsis />
            </Pagination.Item>
          ) : (
            <Pagination.Item key={p}>
              <Pagination.Link isActive={p === current} onPress={() => onChange(p)}>
                {p}
              </Pagination.Link>
            </Pagination.Item>
          ),
        )}
        <Pagination.Item>
          <Pagination.Next
            isDisabled={current === totalPages}
            onPress={() => onChange(current + 1)}
          >
            <Pagination.NextIcon />
          </Pagination.Next>
        </Pagination.Item>
      </Pagination.Content>
    </Pagination>
  )
}
