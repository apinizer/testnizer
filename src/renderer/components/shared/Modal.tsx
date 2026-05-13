import * as Dialog from '@radix-ui/react-dialog'
import { ReactNode, CSSProperties } from 'react'
import { Z } from '../../lib/z-index'

interface ModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: ReactNode
  /** Accessible name. Modal content already shows a visible title; this is for screen readers. */
  title: string
  /** Accessible description (optional). */
  description?: string
  /** Block ESC + click-outside dismissal. Use for critical/busy states. */
  preventClose?: boolean
  /** z-index for overlay + content. Content sits one above overlay. */
  zIndex?: number
  /** Override the default centered positioning class on the content box. Pass full positioning (e.g. 'fixed inset-y-0 right-0') for slide-in panels. */
  contentClassName?: string
  contentStyle?: CSSProperties
}

const DEFAULT_CONTENT_CLASS = 'fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2'

const visuallyHidden: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0,0,0,0)',
  whiteSpace: 'nowrap',
  border: 0,
}

export default function Modal({
  open,
  onOpenChange,
  children,
  title,
  description,
  preventClose = false,
  zIndex = Z.MODAL,
  contentClassName,
  contentStyle,
}: ModalProps) {
  const block = preventClose ? (e: Event) => e.preventDefault() : undefined
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          className="fixed inset-0"
          style={{ background: 'rgba(0,0,0,0.4)', zIndex }}
        />
        <Dialog.Content
          onEscapeKeyDown={block}
          onPointerDownOutside={block}
          onInteractOutside={block}
          className={contentClassName ?? DEFAULT_CONTENT_CLASS}
          style={{ zIndex: zIndex + 1, ...contentStyle }}
        >
          <Dialog.Title style={visuallyHidden}>{title}</Dialog.Title>
          <Dialog.Description style={visuallyHidden}>{description ?? title}</Dialog.Description>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
