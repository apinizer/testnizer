import { useState, useCallback, useEffect, useRef } from 'react'
import { AlertTriangle } from 'lucide-react'
import Modal from '../shared/Modal'
import { useTranslation } from '../../lib/i18n'

interface DeleteConfirmDialogProps {
  open: boolean
  itemName: string
  /** Raw item type — logic keys off it (e.g. `'folder'` picks the folder warning). */
  itemType: string
  /** Translated type name for the heading. Falls back to `itemType`. */
  typeLabel?: string
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
  typeLabel,
  onConfirm,
  onCancel,
  requireTyping = false,
  description,
}: DeleteConfirmDialogProps) {
  const { t, locale } = useTranslation()
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
    itemType === 'folder' ? t('deleteConfirm.folderDesc') : t('deleteConfirm.cannotUndo')

  // EN reads "Delete {type}", TR "{type} silinsin mi?" — the type can lead the
  // sentence, so capitalise whatever comes first (with the locale's casing).
  const headingRaw = t('deleteConfirm.heading').replace('{type}', typeLabel ?? itemType)
  const heading = headingRaw.charAt(0).toLocaleUpperCase(locale) + headingRaw.slice(1)
  const [questionBefore, questionAfter = ''] = t('deleteConfirm.question').split('{name}')
  const [typeBefore, typeAfter = ''] = t('deleteConfirm.typeToConfirm').split('{word}')

  return (
    <Modal open={open} onOpenChange={(o) => !o && onCancel()} title={t('deleteConfirm.title')}>
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
              {heading}
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
            {questionBefore}
            <strong>{itemName}</strong>
            {questionAfter}
          </p>

          {requireTyping && (
            <>
              <p className="mt-3" style={{ fontSize: 13, color: 'var(--muted)' }}>
                {/* The keyword stays the literal "delete" in every locale — it is
                    what the confirm check compares against. */}
                {typeBefore}
                <strong style={{ color: 'var(--text)' }}>delete</strong>
                {typeAfter}
              </p>
              <input
                ref={inputRef}
                type="text"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                data-testid="delete-confirm-input"
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
            data-testid="delete-cancel-btn"
            className="cursor-pointer rounded-md border px-3.5 py-1.5 font-medium transition-colors hover:opacity-80"
            style={{
              fontSize: 13,
              borderColor: 'var(--border)',
              background: 'var(--white)',
              color: 'var(--text)',
            }}
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!canConfirm}
            data-testid="delete-confirm-btn"
            className="rounded-md px-3.5 py-1.5 font-medium text-white transition-colors"
            style={{
              fontSize: 13,
              background: canConfirm ? '#cc2200' : '#e0a0a0',
              cursor: canConfirm ? 'pointer' : 'not-allowed',
              opacity: canConfirm ? 1 : 0.6,
            }}
          >
            {t('common.delete')}
          </button>
        </div>
      </div>
    </Modal>
  )
}
