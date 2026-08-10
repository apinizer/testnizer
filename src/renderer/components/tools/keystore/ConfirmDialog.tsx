import { useTranslation } from '../../../lib/i18n'
import { Modal } from './dialog-ui'

/**
 * Generic confirm dialog for the Keystore Studio (delete entry, discard unsaved
 * changes). Kept separate from `ModalActions` so the confirm button can carry a
 * `danger` (red) treatment and a custom label.
 */
export default function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel,
  danger,
  onConfirm,
  onCancel,
}: {
  title: string
  message: string
  confirmLabel: string
  cancelLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  return (
    <Modal title={title} onClose={onCancel}>
      <p className="text-xs" style={{ color: 'var(--text)' }}>
        {message}
      </p>
      <div className="flex justify-end gap-2 pt-1">
        <button
          onClick={onCancel}
          className="rounded border px-3 py-1 text-xs"
          style={{
            borderColor: 'var(--border)',
            background: 'var(--white)',
            color: 'var(--muted)',
          }}
        >
          {cancelLabel ?? t('tools.keystore.cancel')}
        </button>
        <button
          onClick={onConfirm}
          className="rounded px-3 py-1 text-xs font-medium text-white"
          style={{ background: danger ? '#cc2200' : 'var(--accent)' }}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  )
}
