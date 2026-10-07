import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import Modal from '../../shared/Modal'
import { useTranslation } from '../../../lib/i18n'

interface Props {
  title: string
  testId: string
  onClose: () => void
  children: ReactNode
  footer: ReactNode
}

/** Shared chrome for the MCP config modals — header, scrollable body, footer. Escape closes. */
export default function McpModalFrame({ title, testId, onClose, children, footer }: Props) {
  const { t } = useTranslation()
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={title} testId={testId}>
      <div className="flex max-h-[80vh] w-[640px] max-w-[92vw] flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--white)] text-[13px] text-[var(--text)] shadow-[var(--shadow-modal)]">
        <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] px-5 py-3">
          <span className="text-[15px] font-semibold">{title}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('mcp.config.close')}
            className="ml-auto flex cursor-pointer items-center rounded border-none bg-transparent p-1 text-[var(--muted)] hover:bg-[var(--surface)]"
          >
            <X size={16} />
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-5 py-4">{children}</div>
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-[var(--border)] bg-[var(--surface)] px-5 py-3">
          {footer}
        </div>
      </div>
    </Modal>
  )
}
