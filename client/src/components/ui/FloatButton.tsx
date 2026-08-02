import type { ReactNode } from 'react'
import { Button, Tooltip } from '@heroui/react'

// HeroUI has no FloatButton, so we compose one from Button + Tooltip.
// `side` picks the corner; both corners sit above the tab bar on mobile.

type FloatButtonProps = {
  icon: ReactNode
  tooltip: string
  onPress: () => void
  side?: 'left' | 'right'
  variant?: 'primary' | 'secondary'
  className?: string
}

export function FloatButton({
  icon,
  tooltip,
  onPress,
  side = 'right',
  variant = 'secondary',
  className = '',
}: FloatButtonProps) {
  return (
    <div
      className={`fixed bottom-6 z-[1200] ${
        side === 'left' ? 'left-6' : 'right-6'
      } ${className}`}
    >
      <Tooltip delay={200}>
        <Button
          isIconOnly
          aria-label={tooltip}
          className="size-12 rounded-full shadow-card"
          onPress={onPress}
          variant={variant}
        >
          {icon}
        </Button>
        <Tooltip.Content showArrow placement={side === 'left' ? 'right' : 'left'}>
          <Tooltip.Arrow />
          <p>{tooltip}</p>
        </Tooltip.Content>
      </Tooltip>
    </div>
  )
}
