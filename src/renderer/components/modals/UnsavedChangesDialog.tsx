import { useEffect, useRef } from 'react'
import { AlertTriangle } from 'lucide-react'
import Modal from '../shared/Modal'

interface UnsavedChangesDialogProps {
  open: boolean
  /** Name of the request/tab being closed, shown in the prompt. */
  itemName: string
  /** True while the Save action is in flight (disables the buttons). */
  saving?: boolean
  onSave: () => void
  onDiscard: () => void
  onCancel: () => void
}

/**
 * Three-way confirm shown when closing a tab with unsaved changes (issue #9):
 * Save (persist then close) · Discard (close, lose changes) · Cancel (keep open).
 * Replaces the silent discard on the × button and the weaker 2-way
 * `window.confirm` the menu / Cmd+W paths used.
 */
export default function UnsavedChangesDialog({
  open,
  itemName,
  saving = false,
  onSave,
  onDiscard,
  onCancel,
}: UnsavedChangesDialogProps) {
  const saveRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (open) setTimeout(() => saveRef.current?.focus(), 50)
  }, [open])

  if (!open) return null

  return (
    <Modal open={open} onOpenChange={(o) => !o && onCancel()} title="Unsaved changes">
      <div
        className="w-[440px] rounded-lg border shadow-xl"
        style={{ background: 'var(--white)', borderColor: 'var(--border)' }}
      >
        {/* Header */}
        <div
          className="flex items-center gap-2.5 border-b px-5 py-4"
          style={{ borderColor: 'var(--border)' }}
        >
          <div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
            style={{
              background: 'rgba(179, 90, 0, 0.12)',
              border: '1px solid rgba(179, 90, 0, 0.35)',
            }}
          >
            <AlertTriangle size={16} style={{ color: '#b35a00' }} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold" style={{ fontSize: 13, color: 'var(--text)' }}>
              Unsaved changes
            </h3>
            <p className="mt-0.5" style={{ fontSize: 13, color: 'var(--muted)' }}>
              Save your changes before closing this tab?
            </p>
          </div>
        </div>

        {/* Body */}
        <div className="px-5 py-4">
          <p
            style={{
              fontSize: 13,
              color: 'var(--text)',
              overflowWrap: 'anywhere',
              wordBreak: 'break-word',
            }}
          >
            <strong>{itemName}</strong> has unsaved changes. They will be lost if you close without
            saving.
          </p>
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-between gap-2 border-t px-5 py-3"
          style={{ borderColor: 'var(--border)' }}
        >
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            data-testid="unsaved-cancel-btn"
            className="cursor-pointer rounded-md border px-3.5 py-1.5 font-medium transition-colors hover:opacity-80"
            style={{
              fontSize: 13,
              borderColor: 'var(--border)',
              background: 'var(--white)',
              color: 'var(--text)',
              opacity: saving ? 0.6 : 1,
            }}
          >
            Cancel
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onDiscard}
              disabled={saving}
              data-testid="unsaved-discard-btn"
              className="cursor-pointer rounded-md border px-3.5 py-1.5 font-medium transition-colors hover:opacity-80"
              style={{
                fontSize: 13,
                borderColor: 'rgba(204, 34, 0, 0.4)',
                background: 'var(--white)',
                color: '#cc2200',
                opacity: saving ? 0.6 : 1,
              }}
            >
              Discard
            </button>
            <button
              ref={saveRef}
              type="button"
              onClick={onSave}
              disabled={saving}
              data-testid="unsaved-save-btn"
              className="rounded-md px-3.5 py-1.5 font-medium text-white transition-colors"
              style={{
                fontSize: 13,
                background: 'var(--accent)',
                cursor: saving ? 'not-allowed' : 'pointer',
                opacity: saving ? 0.7 : 1,
              }}
            >
              {saving ? 'Saving…' : 'Save & Close'}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
