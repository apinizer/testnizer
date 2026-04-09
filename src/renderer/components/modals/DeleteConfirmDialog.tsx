import { useState, useCallback, useEffect, useRef } from 'react'
import { AlertTriangle } from 'lucide-react'

interface DeleteConfirmDialogProps {
  open: boolean
  itemName: string
  itemType: 'folder' | 'endpoint' | 'request'
  onConfirm: () => void
  onCancel: () => void
}

export default function DeleteConfirmDialog({
  open,
  itemName,
  itemType,
  onConfirm,
  onCancel,
}: DeleteConfirmDialogProps) {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setValue('')
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && value.toLowerCase() === 'delete') {
        onConfirm()
      } else if (e.key === 'Escape') {
        onCancel()
      }
    },
    [value, onConfirm, onCancel]
  )

  if (!open) return null

  const typeLabel = itemType === 'folder' ? 'folder and all its contents' : itemType === 'endpoint' ? 'endpoint' : 'request'

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.4)' }}
      onClick={onCancel}
    >
      <div
        className="w-[420px] rounded-lg border shadow-xl"
        style={{ background: 'var(--white)', borderColor: 'var(--border)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2.5 border-b px-5 py-4" style={{ borderColor: 'var(--border)' }}>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full" style={{ background: '#fff0f0' }}>
            <AlertTriangle size={16} style={{ color: '#cc2200' }} />
          </div>
          <div>
            <h3 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Delete {itemType}</h3>
            <p className="mt-0.5 text-xs" style={{ color: 'var(--muted)' }}>This action cannot be undone</p>
          </div>
        </div>

        {/* Body */}
        <div className="px-5 py-4">
          <p className="text-sm" style={{ color: 'var(--text)' }}>
            Are you sure you want to delete <strong>{itemName}</strong>?
            {itemType === 'folder' && (
              <span style={{ color: '#cc2200' }}> This will permanently delete the {typeLabel}.</span>
            )}
          </p>

          <p className="mt-3 text-xs" style={{ color: 'var(--muted)' }}>
            Type <strong style={{ color: 'var(--text)' }}>delete</strong> to confirm:
          </p>
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="delete"
            className="mt-1.5 w-full rounded-md border px-3 py-2 text-sm outline-none transition-colors"
            style={{
              borderColor: value.toLowerCase() === 'delete' ? '#cc2200' : 'var(--border)',
              background: 'var(--bg)',
              color: 'var(--text)',
            }}
          />
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t px-5 py-3" style={{ borderColor: 'var(--border)' }}>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border px-3.5 py-1.5 text-sm font-medium transition-colors hover:opacity-80"
            style={{ borderColor: 'var(--border)', background: 'var(--white)', color: 'var(--text)' }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={value.toLowerCase() !== 'delete'}
            className="rounded-md px-3.5 py-1.5 text-sm font-medium text-white transition-colors"
            style={{
              background: value.toLowerCase() === 'delete' ? '#cc2200' : '#e0a0a0',
              cursor: value.toLowerCase() === 'delete' ? 'pointer' : 'not-allowed',
              opacity: value.toLowerCase() === 'delete' ? 1 : 0.6,
            }}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}
