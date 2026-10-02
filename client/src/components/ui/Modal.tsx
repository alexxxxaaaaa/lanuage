import type { ReactNode } from 'react'
import { Modal as HeroModal } from '@heroui/react'

// Thin wrapper over HeroUI's compound Modal. Every modal in this app is
// controlled and headless (title + body, actions rendered by the caller), so
// this keeps the five levels of nesting in one place.

type ModalProps = {
  isOpen: boolean
  onClose: () => void
  title?: ReactNode
  children: ReactNode
  footer?: ReactNode
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'cover' | 'full'
  isDismissable?: boolean
  /** 连 Esc 也不关。给「关掉就丢输入」的弹窗用 —— 只禁点击外部是不够的。 */
  isKeyboardDismissDisabled?: boolean
  className?: string
}

export function Modal({
  isOpen,
  onClose,
  title,
  children,
  footer,
  size = 'md',
  isDismissable = true,
  isKeyboardDismissDisabled = false,
  className,
}: ModalProps) {
  return (
    <HeroModal.Backdrop
      isDismissable={isDismissable}
      isKeyboardDismissDisabled={isKeyboardDismissDisabled}
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <HeroModal.Container size={size}>
        <HeroModal.Dialog className={className}>
          <HeroModal.CloseTrigger />
          {title ? (
            <HeroModal.Header>
              <HeroModal.Heading>{title}</HeroModal.Heading>
            </HeroModal.Header>
          ) : null}
          <HeroModal.Body>{children}</HeroModal.Body>
          {footer ? <HeroModal.Footer>{footer}</HeroModal.Footer> : null}
        </HeroModal.Dialog>
      </HeroModal.Container>
    </HeroModal.Backdrop>
  )
}
