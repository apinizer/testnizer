/**
 * Export a run report to a file (issue #266) — ONE flow for every surface:
 * the live Runner results header, All Runs rows and scheduled-task history.
 *
 * The renderer builds NO report text. Main is the one generator
 * (`runner:export` → `src/main/lib/run-report.ts` `buildRunReport`, which
 * also masks secrets), and the existing `export:saveFile` dialog writes
 * exactly the string main returned — so the downloaded file is the same text
 * a run fail script's `pm.run.exportHtml()` mails (issue #267).
 */
import type { EndpointRunResult } from '../../shared/runner-types'
import { t } from './i18n'
import { toast } from './toast'

export type RunReportFormat = 'html' | 'json'

const pad = (n: number): string => String(n).padStart(2, '0')

/** `testnizer-run-report-YYYYMMDD-HHmmss.<format>` (local time, sortable). */
export function runReportFileName(format: RunReportFormat, at: Date = new Date()): string {
  const stamp =
    `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}` +
    `-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`
  return `testnizer-run-report-${stamp}.${format}`
}

function reportFailure(error: string): false {
  toast.error(t('runner.exportFailed').replace('{error}', error))
  return false
}

/**
 * Ask main for the report, then save it through the native dialog.
 * Resolves true only when a file was written; a dismissed dialog is silent.
 */
export async function exportRunReport(
  results: EndpointRunResult[],
  format: RunReportFormat,
  /** The run's environment (issue #307, `src/shared/run-environment.ts`). */
  environmentName?: string | null,
): Promise<boolean> {
  try {
    const build = window.api?.runner?.export
    const save = window.api?.importExport?.saveFile
    if (!build || !save) return reportFailure('export is not available')
    // Unknown (null / absent) is not sent: the report then prints nothing.
    const built = await build({
      results,
      format,
      ...(typeof environmentName === 'string' ? { environmentName } : {}),
    })
    if (!built?.success || typeof built.data !== 'string') {
      return reportFailure(built?.error ?? 'the report could not be built')
    }
    const saved = await save(built.data, runReportFileName(format))
    if (!saved?.success) return reportFailure(saved?.error ?? 'save failed')
    if (!saved.data) return false // dialog dismissed
    toast.success(t('runner.exportSaved').replace('{path}', saved.data))
    return true
  } catch (e) {
    return reportFailure(e instanceof Error ? e.message : String(e))
  }
}

/**
 * A stored run's `results_json` (All Runs / scheduled history). A corrupt
 * value is reported, never thrown and never saved.
 */
export async function exportStoredRunReport(
  resultsJson: string,
  format: RunReportFormat,
  environmentName?: string | null,
): Promise<boolean> {
  let results: unknown
  try {
    results = JSON.parse(resultsJson)
  } catch (e) {
    return reportFailure(e instanceof Error ? e.message : String(e))
  }
  if (!Array.isArray(results)) return reportFailure('the stored run has no results')
  return exportRunReport(results as EndpointRunResult[], format, environmentName)
}
