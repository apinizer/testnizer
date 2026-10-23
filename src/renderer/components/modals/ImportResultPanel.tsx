import { useState } from 'react'
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight } from 'lucide-react'
import { useTranslation } from '../../lib/i18n'

/** What an importer reported back — the classic `ImportResult` fields the panel shows. */
export interface ImportReport {
  endpointCount?: number
  folderCount?: number
  exampleCount?: number
  environmentName?: string
  warnings: string[]
}

/**
 * Import result step (issue #276): shown instead of closing the Import modal
 * when the importer skipped or degraded something, so nothing is dropped
 * silently. The warnings list is collapsible; "Done" closes the modal.
 */
export default function ImportResultPanel({
  report,
  onDone,
}: {
  report: ImportReport
  onDone: () => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const summary = t('import.result.summary')
    .replace('{endpoints}', String(report.endpointCount ?? 0))
    .replace('{folders}', String(report.folderCount ?? 0))
    .replace('{examples}', String(report.exampleCount ?? 0))

  return (
    <div data-testid="import-result" className="space-y-3">
      <div className="flex items-start gap-2 text-[var(--text)]">
        <CheckCircle2
          size={16}
          className="mt-0.5 shrink-0 text-[var(--green)]"
          aria-hidden="true"
        />
        <div>
          <div className="font-semibold">{t('import.result.title')}</div>
          <div data-testid="import-result-summary" className="text-[var(--sub)]">
            {summary}
          </div>
          {report.environmentName && (
            <div className="text-[var(--sub)]">
              {t('import.result.environment').replace('{name}', report.environmentName)}
            </div>
          )}
        </div>
      </div>

      {report.warnings.length > 0 && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
          <button
            type="button"
            data-testid="import-warnings-toggle"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="flex w-full cursor-pointer items-center gap-2 border-none bg-transparent px-3 py-2 text-left text-[var(--text)]"
          >
            <AlertTriangle size={14} className="shrink-0 text-[var(--orange)]" aria-hidden="true" />
            <span className="flex-1 font-medium">
              {t('import.result.warnings').replace('{n}', String(report.warnings.length))}
            </span>
            <span className="text-[var(--hint)]">
              {open ? t('import.result.hideDetails') : t('import.result.showDetails')}
            </span>
            {open ? (
              <ChevronDown size={14} aria-hidden="true" />
            ) : (
              <ChevronRight size={14} aria-hidden="true" />
            )}
          </button>
          {open && (
            <ul
              data-testid="import-warnings-list"
              className="max-h-[240px] list-disc space-y-1 overflow-y-auto border-t border-[var(--border)] py-2 pl-8 pr-3 text-[var(--sub)]"
            >
              {report.warnings.map((w, i) => (
                <li key={i} data-testid="import-warning" className="break-words">
                  {w}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="flex justify-end border-t border-[var(--border)] pt-4">
        <button
          type="button"
          data-testid="import-result-done"
          onClick={onDone}
          className="cursor-pointer rounded-[7px] border-none bg-[var(--accent)] px-[18px] py-[7px] font-semibold text-white transition-opacity hover:opacity-90"
        >
          {t('import.result.done')}
        </button>
      </div>
    </div>
  )
}
