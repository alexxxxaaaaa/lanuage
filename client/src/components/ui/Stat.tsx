import type { ReactNode } from 'react'

/**
 * One number with a label above and an optional caption below.
 *
 * The home dashboard is built almost entirely out of these, so the type scale
 * lives here rather than being re-spelled per tile — every figure on the page
 * lines up because they all come from the same component.
 */
type StatProps = {
  label: ReactNode
  value: ReactNode
  /** Secondary line under the value — a breakdown, a unit, a small control. */
  hint?: ReactNode
  /** Tints the value with the accent colour. For the one figure that leads. */
  accent?: boolean
}

export function Stat({ label, value, hint, accent = false }: StatProps) {
  return (
    <div className="min-w-0">
      <p className="truncate text-xs font-medium text-muted">{label}</p>
      {/* `tabular-nums` so a counting figure doesn't reflow as digits change. */}
      <p
        className={
          'mt-1.5 truncate text-[28px] leading-none font-bold tabular-nums ' +
          (accent ? 'text-accent' : 'text-foreground')
        }
      >
        {value}
      </p>
      {hint ? <div className="mt-2 text-xs text-muted">{hint}</div> : null}
    </div>
  )
}
