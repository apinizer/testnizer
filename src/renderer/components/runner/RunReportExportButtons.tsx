import { useState } from 'react'
import { Download } from 'lucide-react'
import type { EndpointRunResult } from '../../../shared/runner-types'
import { useTranslation } from '../../lib/i18n'
import {
  exportRunReport,
  exportStoredRunReport,
  type RunReportFormat,
} from '../../lib/run-report-export'

/**
 * Export HTML / Export JSON (issue #266) — the same pair on the live results
 * header, All Runs rows and scheduled-task history rows. Main builds the
 * report; this only picks the format and the source.
 *
 * `results` = a finished live run; `resultsJson` = a stored run (parsed on
 * click, so a corrupt row reports an error instead of breaking the list).
 * Clicks never bubble: a history row's own click opens the report.
 */
export default function RunReportExportButtons({
  results,
  resultsJson,
  compact = false,
}: {
  results?: EndpointRunResult[]
  resultsJson?: string
  compact?: boolean
}) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)

  const run = async (format: RunReportFormat): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      if (results) await exportRunReport(results, format)
      else if (resultsJson !== undefined) await exportStoredRunReport(resultsJson, format)
    } finally {
      setBusy(false)
    }
  }

  const cls = compact
    ? 'flex cursor-pointer items-center gap-1 rounded-[4px] border border-[var(--border)] bg-[var(--white)] px-1.5 py-0.5 text-[11px] text-[var(--muted)] hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50'
    : 'flex cursor-pointer items-center gap-1.5 rounded-[6px] border border-[var(--border)] bg-[var(--white)] px-3 py-1.5 text-sm text-[var(--muted)] hover:bg-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-50'

  const button = (format: RunReportFormat, label: string) => (
    <button
      type="button"
      data-testid={`runner-export-${format}`}
      disabled={busy}
      title={label}
      onClick={(e) => {
        e.stopPropagation()
        void run(format)
      }}
      className={cls}
    >
      <Download size={compact ? 11 : 13} />
      {label}
    </button>
  )

  return (
    <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
      {button('html', t('runner.exportHtml'))}
      {button('json', t('runner.exportJson'))}
    </div>
  )
}
