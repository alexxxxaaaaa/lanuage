import type { ComponentPropsWithoutRef, ElementType, ReactNode } from 'react'

/**
 * Shared row primitive behind every sidebar entry. Guarantees:
 *   - Full-width hit area matching the rail width.
 *   - A 64px icon column at the left edge, so icons stay pinned in place
 *     across the collapse/expand transition.
 *   - The trailing label fades and truncates without moving the icon.
 *   - Consistent hover / pressed / active treatment.
 */
type SidebarRowOwnProps = {
  icon: ReactNode
  label: ReactNode
  collapsed?: boolean
  active?: boolean
  tone?: 'default' | 'accent' | 'danger'
  trailing?: ReactNode
}

type PolymorphicProps<E extends ElementType> = SidebarRowOwnProps & {
  as?: E
} & Omit<ComponentPropsWithoutRef<E>, keyof SidebarRowOwnProps | 'as'>

type Tone = NonNullable<SidebarRowOwnProps['tone']>

// Idle and active are separate maps rather than "idle + active overrides":
// concatenating `text-accent` after `text-foreground` would leave the winner
// up to Tailwind's stylesheet ordering, not the class-string order.
const TONE_STYLES: Record<Tone, string> = {
  default: 'text-muted hover:bg-background-secondary hover:text-foreground',
  accent: 'text-foreground hover:bg-accent/10 active:bg-accent/15',
  danger: 'text-danger hover:bg-danger/10 active:bg-danger/15',
}

const ACTIVE_TONE_STYLES: Record<Tone, string> = {
  default: 'bg-background-secondary font-semibold text-foreground',
  accent: 'bg-accent/10 font-semibold text-accent hover:bg-accent/15',
  danger: 'bg-danger/10 font-semibold text-danger hover:bg-danger/15',
}

export function SidebarRow<E extends ElementType = 'button'>({
  as,
  icon,
  label,
  collapsed = false,
  active = false,
  tone = 'default',
  trailing,
  className,
  title,
  ...rest
}: PolymorphicProps<E>) {
  const Component = (as ?? 'button') as ElementType

  return (
    <Component
      {...rest}
      data-active={active || undefined}
      title={collapsed && typeof label === 'string' ? (title ?? label) : title}
      aria-current={active ? 'page' : undefined}
      className={
        'relative flex h-12 w-full shrink-0 cursor-pointer items-center text-left text-sm no-underline outline-none ' +
        'transition-colors focus-visible:bg-background-secondary ' +
        (active ? ACTIVE_TONE_STYLES[tone] : TONE_STYLES[tone]) +
        (className ? ` ${className}` : '')
      }
    >
      {/* Active marker rides the left edge so it stays visible when collapsed. */}
      {active && (
        <span
          aria-hidden
          className="absolute inset-y-1.5 left-0 w-0.5 rounded-r-full bg-accent"
        />
      )}
      <span className="flex h-12 w-16 shrink-0 items-center justify-center">{icon}</span>
      <span
        aria-hidden={collapsed || undefined}
        className={
          'min-w-0 flex-1 truncate pr-3 transition-[opacity,transform] duration-200 ' +
          (collapsed
            ? 'pointer-events-none -translate-x-1 opacity-0'
            : 'translate-x-0 opacity-100')
        }
      >
        {label}
      </span>
      {trailing && !collapsed && (
        <span className="pr-3 transition-opacity duration-200">{trailing}</span>
      )}
    </Component>
  )
}
