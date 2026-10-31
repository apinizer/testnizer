import { useEffect, useRef } from 'react'
import { AlertTriangle } from 'lucide-react'
import Modal from '../shared/Modal'
import { useTranslation } from '../../lib/i18n'

interface Props {
  open: boolean
  /** Where the switch goes ("App settings" / "Project settings"), already translated. */
  target: string
  /** True while Save is in flight (buttons locked). */
  saving: boolean
  onSave: () => void
  onDiscard: () => void
  onCancel: () => void
}

/**
 * Issue #254: the App ⇄ Project settings cross-link never drops an unsaved
 * draft silently. Same anatomy and order as `UnsavedChangesDialog` (Cancel
 * left, Discard + Save right); Save is focused, Esc = Cancel.
 */
export default function SettingsSwitchUnsavedDialog({
  open,
  target,
  saving,
  onSave,
  onDiscard,
  onCancel,
}: Props) {
  const { t } = useTranslation()
  const saveRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const id = setTimeout(() => saveRef.current?.focus(), 50)
    return () => clearTimeout(id)
  }, [open])

  if (!open) return null
  const title = t('settingsScope.unsavedTitle')
  const btn =
    'cursor-pointer rounded-md border px-3.5 py-1.5 font-medium transition-colors hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-60'

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && !saving && onCancel()}
      title={title}
      preventClose={saving}
      testId="settings-switch-unsaved-dialog"
    >
      <div className="w-[440px] rounded-lg border border-[var(--border)] bg-[var(--white)] shadow-xl">
        <div className="flex items-center gap-2.5 border-b border-[var(--border)] px-5 py-4">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--orange)] bg-[var(--bg)]">
            <AlertTriangle size={16} className="text-[var(--orange)]" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-[var(--text)]">{title}</h3>
            <p className="mt-0.5 text-[var(--muted)]">
              {t('settingsScope.unsavedBody').replace('{target}', target)}
            </p>
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 px-5 py-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            data-testid="settings-switch-unsaved-cancel"
            className={`${btn} border-[var(--border)] bg-[var(--white)] text-[var(--text)]`}
          >
            {t('settingsScope.unsavedCancel')}
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onDiscard}
              disabled={saving}
              data-testid="settings-switch-unsaved-discard"
              className={`${btn} border-[var(--red)] bg-[var(--white)] text-[var(--red)]`}
            >
              {t('settingsScope.unsavedDiscard')}
            </button>
            <button
              ref={saveRef}
              type="button"
              onClick={onSave}
              disabled={saving}
              data-testid="settings-switch-unsaved-save"
              className={`${btn} border-transparent bg-[var(--accent)] text-white`}
            >
              {saving ? t('modal.saving') : t('settingsScope.unsavedSave')}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
