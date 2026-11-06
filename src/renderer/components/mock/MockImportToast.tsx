/**
 * A finished import that lost something: what arrived, and every note about what
 * did not. Stays until closed, since the notes are there to be read.
 */
import { AlertTriangle, X } from 'lucide-react'
import { useTranslation } from '../../lib/i18n'

export default function MockImportToast({
  summary,
  warnings,
  onClose,
}: {
  summary: string
  warnings: readonly string[]
  onClose: () => void
}) {
  const { t } = useTranslation()
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="mock-import-toast"
      className="flex w-[356px] max-w-full flex-col gap-1.5 rounded-xl border border-[var(--border)] bg-[var(--white)] px-3.5 py-3 text-[var(--text)] shadow-[var(--shadow-drop)]"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle
          size={14}
          aria-hidden="true"
          className="mt-0.5 shrink-0 text-[var(--orange)]"
        />
        <span className="flex-1 text-sm font-medium">{summary}</span>
        <button
          type="button"
          data-testid="mock-import-toast-close"
          aria-label={t('mockNew.close')}
          onClick={onClose}
          className="shrink-0 cursor-pointer rounded p-0.5 text-[var(--hint)] hover:text-[var(--text)]"
        >
          <X size={13} aria-hidden="true" />
        </button>
      </div>
      <ul className="ml-[22px] max-h-[200px] list-disc space-y-0.5 overflow-y-auto pl-3 text-xs text-[var(--muted)] [overflow-wrap:anywhere]">
        {warnings.map((warning, i) => (
          <li key={i} data-testid="mock-import-warning">
            {warning}
          </li>
        ))}
      </ul>
    </div>
  )
}
