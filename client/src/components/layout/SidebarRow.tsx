import type { ComponentPropsWithRef, ElementType, ReactNode } from 'react'

/**
 * Shared row primitive behind every sidebar entry. Guarantees:
 *   - Full-width hit area matching the rail card's content box.
 *   - A 30px icon column, inset from the row's own edge by 8px so the selected
 *     tint never crowds its contents. Every horizontal step is fixed, so an
 *     icon lands 42px from the rail's outer edge whether the rail is collapsed
 *     or expanded — icons never move:
 *
 *       12 rail padding + 1 card border + 6 card padding
 *          + 8 row padding + 15 (half the icon column) = 42
 *
 *     The collapsed rail's width is that sum mirrored: 2×27 + 30 = 84px.
 *     The four steps can be traded against each other freely — that is how the
 *     row gained padding and the card gained its corner clearance without the
 *     icons shifting — but their sum must stay 27, or the rail width has to
 *     follow and the row overflows the card and gets clipped.
 *   - The trailing label fades and truncates without moving the icon.
 *   - Consistent hover / focus / active treatment.
 */
type SidebarRowOwnProps = {
  icon: ReactNode
  label: ReactNode
  collapsed?: boolean
  /** Selected styling only — the caller owns `aria-current` / `aria-expanded`. */
  active?: boolean
  trailing?: ReactNode
}

type PolymorphicProps<E extends ElementType> = SidebarRowOwnProps & {
  as?: E
} & Omit<ComponentPropsWithRef<E>, keyof SidebarRowOwnProps | 'as'>

// Idle and active are separate strings rather than "idle + active overrides":
// concatenating `text-accent` after `text-foreground` would leave the winner
// up to Tailwind's stylesheet ordering, not the class-string order.
const IDLE = 'text-foreground/75 hover:bg-foreground/6 hover:text-foreground'
const ACTIVE = 'bg-accent/12 font-semibold text-accent hover:bg-accent/16'

export function SidebarRow<E extends ElementType = 'button'>({
  as,
  icon,
  label,
  collapsed = false,
  active = false,
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
      className={
        // `rounded-2xl` rather than the rows' old 12px: against the card's own
        // 24px corner a 12px pill ran flush with the curve and read as touching
        // the border. 16px pulls its corners clear of it.
        'flex h-12 w-full shrink-0 cursor-pointer items-center rounded-2xl px-2 text-left text-sm no-underline outline-none ' +
        // The ring is inset: rows sit 6px from the card's edge, so an outward
        // ring would spill over the border and read as the row growing.
        'transition-colors focus-visible:inset-ring-2 focus-visible:inset-ring-focus ' +
        (active ? ACTIVE : IDLE) +
        (className ? ` ${className}` : '')
      }
    >
      <span className="flex h-full w-7.5 shrink-0 items-center justify-center">{icon}</span>
      <span
        aria-hidden={collapsed || undefined}
        className={
          'min-w-0 flex-1 truncate pl-1.5 pr-2 transition-[opacity,transform] duration-200 ' +
          (collapsed
            ? 'pointer-events-none -translate-x-1 opacity-0'
            : 'translate-x-0 opacity-100')
        }
      >
        {label}
      </span>
      {trailing && !collapsed && (
        <span className="pr-1 transition-opacity duration-200">{trailing}</span>
      )}
    </Component>
  )
}
