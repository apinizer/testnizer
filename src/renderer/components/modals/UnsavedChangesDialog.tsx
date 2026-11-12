import { useEffect, useRef } from 'react'
import { AlertTriangle } from 'lucide-react'
import Modal from '../shared/Modal'
import { useTranslation } from '../../lib/i18n'
import { formatCount } from '../../lib/plural'

/** How many unsaved request names a project close lists before "+N more". */
const MAX_LISTED = 5

interface UnsavedChangesDialogProps {
  open: boolean
  /** Name of the request/tab — or, with `unsavedNames`, the project — being closed. */
  itemName: string
  /**
   * Closing a whole project (its header tab): the names of its unsaved
   * requests. Same dialog, same buttons; only the wording and the list differ.
   */
  unsavedNames?: string[]
  /** True while the Save action is in flight (disables the buttons). */
  saving?: boolean
  onSave: () => void
  onDiscard: () => void
  onCancel: () => void
}

/**
 * Three-way confirm shown when closing a tab — or a project's header tab —
 * with unsaved changes (issue #9):
 * Save (persist then close) · Discard (close, lose changes) · Cancel (keep open).
 * Replaces the silent discard on the × button and the weaker 2-way
 * `window.confirm` the menu / Cmd+W paths used.
 */
export default function UnsavedChangesDialog({
  open,
  itemName,
  unsavedNames,
  saving = false,
  onSave,
  onDiscard,
  onCancel,
}: UnsavedChangesDialogProps) {
  const { t } = useTranslation()
  const saveRef = useRef<HTMLButtonElement>(null)
  const isProject = unsavedNames !== undefined
  const count = unsavedNames?.length ?? 0
  const bodyTemplate = isProject
    ? formatCount(count, t('unsaved.projectBodyOne'), t('unsaved.projectBody'))
    : t('unsaved.tabBody')
  const [beforeName, afterName = ''] = bodyTemplate.split('{name}')

  useEffect(() => {
    if (open) setTimeout(() => saveRef.current?.focus(), 50)
  }, [open])

  if (!open) return null

  return (
    <Modal open={open} onOpenChange={(o) => !o && onCancel()} title={t('unsaved.title')}>
      <div
        data-testid="unsaved-changes-dialog"
        data-scope={isProject ? 'project' : 'tab'}
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
              {t('unsaved.title')}
            </h3>
            <p className="mt-0.5" style={{ fontSize: 13, color: 'var(--muted)' }}>
              {t(isProject ? 'unsaved.projectQuestion' : 'unsaved.tabQuestion')}
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
            {beforeName}
            <strong>{itemName}</strong>
            {afterName}
          </p>
          {isProject && count > 0 && (
            <ul
              data-testid="unsaved-names"
              className="mt-2 list-disc pl-5 text-sm text-[var(--sub)] [overflow-wrap:anywhere]"
            >
              {unsavedNames.slice(0, MAX_LISTED).map((name, i) => (
                <li key={`${i}-${name}`}>{name}</li>
              ))}
              {count > MAX_LISTED && (
                <li className="list-none text-[var(--muted)]">
                  {t('unsaved.moreNames', { count: String(count - MAX_LISTED) })}
                </li>
              )}
            </ul>
          )}
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
            {t('unsaved.cancel')}
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
              {t('unsaved.discard')}
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
              {saving ? t('unsaved.saving') : t('unsaved.saveAndClose')}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
