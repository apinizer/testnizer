import { useEffect, useRef } from 'react'
import { AlertTriangle } from 'lucide-react'
import Modal from '../shared/Modal'
import { useTranslation } from '../../lib/i18n'
import type { MockMcpBlankItem } from './mock-mcp-dirty'

const KIND_KEYS: Record<MockMcpBlankItem['kind'], string> = {
  tool: 'mockMcp.blank.tool',
  resource: 'mockMcp.blank.resource',
  prompt: 'mockMcp.blank.prompt',
}

/**
 * "Save items still at their defaults?" (issue #210). "Add" inserts a ready
 * default item at once, so a forgotten one was easy to save by accident.
 * Focus starts on Go back; Esc goes back too.
 */
export default function MockMcpBlankItemsDialog({
  items,
  onSaveAnyway,
  onGoBack,
}: {
  /** Empty = closed. */
  items: readonly MockMcpBlankItem[]
  onSaveAnyway: () => void
  onGoBack: () => void
}) {
  const { t } = useTranslation()
  const backRef = useRef<HTMLButtonElement>(null)
  const open = items.length > 0
  useEffect(() => {
    if (!open) return
    const timer = setTimeout(() => backRef.current?.focus(), 0)
    return () => clearTimeout(timer)
  }, [open])

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && onGoBack()}
      title={t('mockMcp.blank.title')}
      description={t('mockMcp.blank.body')}
      testId="mock-mcp-blank-dialog"
    >
      <div className="w-[440px] max-w-[calc(100vw-2rem)] rounded-lg border border-[var(--border)] bg-[var(--white)] shadow-xl">
        <div className="flex items-start gap-2.5 px-5 py-4">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--surface)] text-[var(--orange)]">
            <AlertTriangle size={16} aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-[13px] font-semibold text-[var(--text)]">
              {t('mockMcp.blank.title')}
            </h3>
            <p className="mt-1 text-[13px] text-[var(--muted)]">{t('mockMcp.blank.body')}</p>
            <ul
              data-testid="mock-mcp-blank-list"
              className="mt-2 flex max-h-40 list-none flex-col gap-1 overflow-y-auto p-0"
            >
              {items.map((it, i) => (
                <li key={`${it.kind}-${i}`} className="flex min-w-0 gap-2 text-[12px]">
                  <span className="shrink-0 text-[var(--muted)]">{t(KIND_KEYS[it.kind])}</span>
                  <span className="truncate font-mono text-[var(--text)]">{it.label}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-[var(--border)] px-5 py-3">
          <button
            ref={backRef}
            type="button"
            onClick={onGoBack}
            data-testid="mock-mcp-blank-back"
            className="cursor-pointer rounded-md border border-[var(--border)] bg-[var(--white)] px-3.5 py-1.5 text-[13px] font-medium text-[var(--text)] hover:opacity-80"
          >
            {t('mockMcp.blank.goBack')}
          </button>
          <button
            type="button"
            onClick={onSaveAnyway}
            data-testid="mock-mcp-blank-save"
            className="cursor-pointer rounded-md border-none bg-[var(--accent)] px-3.5 py-1.5 text-[13px] font-medium text-white hover:opacity-90"
          >
            {t('mockMcp.blank.saveAnyway')}
          </button>
        </div>
      </div>
    </Modal>
  )
}
