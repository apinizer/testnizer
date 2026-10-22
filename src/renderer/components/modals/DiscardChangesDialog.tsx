import { useEffect, useRef } from 'react'
import { AlertTriangle } from 'lucide-react'
import Modal from '../shared/Modal'
import { useTranslation } from '../../lib/i18n'

interface DiscardChangesDialogProps {
  open: boolean
  /** Number of changes that will be lost — named in the text and the button. */
  count: number
  onConfirm: () => void
  onCancel: () => void
}

/**
 * "Discard all changes?" (issue #207). The destructive action needs an
 * explicit click: focus starts on Cancel, Esc cancels.
 */
export default function DiscardChangesDialog({
  open,
  count,
  onConfirm,
  onCancel,
}: DiscardChangesDialogProps) {
  const { t } = useTranslation()
  const cancelRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    const timer = setTimeout(() => cancelRef.current?.focus(), 0)
    return () => clearTimeout(timer)
  }, [open])

  const one = count === 1
  const body = one
    ? t('gitCommit.discardBodyOne')
    : t('gitCommit.discardBody').replace('{count}', String(count))
  const confirm = one
    ? t('gitCommit.discardConfirmOne')
    : t('gitCommit.discardConfirm').replace('{count}', String(count))

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && onCancel()}
      title={t('gitCommit.discardTitle')}
      description={body}
      testId="git-discard-dialog"
    >
      <div className="w-[420px] max-w-[calc(100vw-2rem)] rounded-lg border border-[var(--border)] bg-[var(--white)] shadow-xl">
        <div className="flex items-start gap-2.5 px-5 py-4">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--mb-delete-bg)] text-[var(--red)]">
            <AlertTriangle size={16} aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-[var(--text)]">
              {t('gitCommit.discardTitle')}
            </h3>
            <p data-testid="git-discard-body" className="mt-1 text-sm text-[var(--muted)]">
              {body}
            </p>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-[var(--border)] px-5 py-3">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            data-testid="git-discard-cancel"
            className="cursor-pointer rounded-md border border-[var(--border)] bg-[var(--white)] px-3.5 py-1.5 text-sm font-medium text-[var(--text)] hover:opacity-80"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            data-testid="git-discard-confirm"
            className="cursor-pointer rounded-md bg-[var(--red)] px-3.5 py-1.5 text-sm font-medium text-white hover:opacity-90"
          >
            {confirm}
          </button>
        </div>
      </div>
    </Modal>
  )
}
