import type { McpSecurityReport } from '../types/mcp'
import { getMcpApi } from './mcp-api'

/** `mcp-security-<host>-<yyyymmdd-hhmm>.html` — safe on every file system. */
export function securityReportFileName(report: McpSecurityReport): string {
  const host = (report.target?.host || 'server').replace(/[^a-zA-Z0-9.-]+/g, '_')
  const d = new Date(Number.isFinite(report.finishedAt) ? report.finishedAt : Date.now())
  const pad = (n: number): string => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`
  return `mcp-security-${host}-${stamp}.html`
}

export type SaveReportResult = { ok: true; path: string | null } | { ok: false; error: string }

/**
 * "Save HTML report…" (issue #142): main renders the self-contained HTML
 * (`mcp:security:exportHtml`), the existing save-file dialog bridge writes it.
 * `path: null` = the user cancelled the dialog.
 */
export async function saveSecurityReportHtml(report: McpSecurityReport): Promise<SaveReportResult> {
  const api = getMcpApi()
  if (!api?.securityExportHtml) return { ok: false, error: 'Report export is not available' }
  const rendered = await api.securityExportHtml(report)
  if (!rendered.success || !rendered.data) {
    return { ok: false, error: rendered.error ?? 'Could not render the report' }
  }
  const save = window.api?.importExport?.saveFile
  if (!save) return { ok: false, error: 'Saving files is not available' }
  const saved = await save(rendered.data.html, securityReportFileName(report))
  return saved.success
    ? { ok: true, path: saved.data ?? null }
    : { ok: false, error: saved.error ?? 'Save failed' }
}
