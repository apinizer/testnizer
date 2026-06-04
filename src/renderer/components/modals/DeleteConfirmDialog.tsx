import { useState, useCallback, useEffect, useRef } from 'react'
import { AlertTriangle } from 'lucide-react'
import Modal from '../shared/Modal'

interface DeleteConfirmDialogProps {
  open: boolean
  itemName: string
  itemType: string
  onConfirm: () => void
  onCancel: () => void
  /** If true, user must type "delete" to confirm (default: false = simple OK/Cancel) */
  requireTyping?: boolean
  /** Optional custom description shown under the title */
  description?: string
}

export default function DeleteConfirmDialog({
  open,
  itemName,
  itemType,
  onConfirm,
  onCancel,
  requireTyping = false,
  description,
}: DeleteConfirmDialogProps) {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (open) {
      setValue('')
      setTimeout(() => {
        if (requireTyping) inputRef.current?.focus()
        else cancelRef.current?.focus()
      }, 50)
    }
  }, [open, requireTyping])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        if (!requireTyping || value.toLowerCase() === 'delete') {
          onConfirm()
        }
      }
    },
    [value, requireTyping, onConfirm],
  )

  if (!open) return null

  const canConfirm = !requireTyping || value.toLowerCase() === 'delete'

  const defaultDesc =
    itemType === 'folder'
      ? 'This will permanently delete the folder and all its contents.'
      : 'This action cannot be undone.'

  return (
    <Modal open={open} onOpenChange={(o) => !o && onCancel()} title="Delete confirmation">
      <div
        className="w-[420px] rounded-lg border shadow-xl"
        style={{ background: 'var(--white)', borderColor: 'var(--border)' }}
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div
          className="flex items-center gap-2.5 border-b px-5 py-4"
          style={{ borderColor: 'var(--border)' }}
        >
          <div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
            style={{
              background: 'rgba(204, 34, 0, 0.12)',
              border: '1px solid rgba(204, 34, 0, 0.35)',
            }}
          >
            <AlertTriangle size={16} style={{ color: '#cc2200' }} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold" style={{ fontSize: 13, color: 'var(--text)' }}>
              Delete {itemType}
            </h3>
            <p className="mt-0.5" style={{ fontSize: 13, color: 'var(--muted)' }}>
              {description || defaultDesc}
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
            Are you sure you want to delete <strong>{itemName}</strong>?
          </p>

          {requireTyping && (
            <>
              <p className="mt-3" style={{ fontSize: 13, color: 'var(--muted)' }}>
                Type <strong style={{ color: 'var(--text)' }}>delete</strong> to confirm:
              </p>
              <input
                ref={inputRef}
                type="text"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="delete"
                className="mt-1.5 w-full rounded-md border px-3 py-2 outline-none transition-colors"
                style={{
                  fontSize: 13,
                  borderColor: value.toLowerCase() === 'delete' ? '#cc2200' : 'var(--border)',
                  background: 'var(--bg)',
                  color: 'var(--text)',
                }}
              />
            </>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex justify-end gap-2 border-t px-5 py-3"
          style={{ borderColor: 'var(--border)' }}
        >
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="cursor-pointer rounded-md border px-3.5 py-1.5 font-medium transition-colors hover:opacity-80"
            style={{
              fontSize: 13,
              borderColor: 'var(--border)',
              background: 'var(--white)',
              color: 'var(--text)',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!canConfirm}
            className="rounded-md px-3.5 py-1.5 font-medium text-white transition-colors"
            style={{
              fontSize: 13,
              background: canConfirm ? '#cc2200' : '#e0a0a0',
              cursor: canConfirm ? 'pointer' : 'not-allowed',
              opacity: canConfirm ? 1 : 0.6,
            }}
          >
            Delete
          </button>
        </div>
      </div>
    </Modal>
  )
}
