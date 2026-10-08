import { useState } from 'react'
import { Download } from 'lucide-react'
import type { McpSecurityReport } from '../../../types/mcp'
import { useTranslation } from '../../../lib/i18n'
import { saveSecurityReportHtml } from '../../../lib/mcp-security-export'
import { GhostButton } from './ui'
import { GRADE_CLASS } from './security-ui'

const COUNTS = [
  ['fail', 'text-[var(--red)]'],
  ['warn', 'text-[var(--orange)]'],
  ['pass', 'text-[var(--green)]'],
  ['info', 'text-[var(--blue)]'],
  ['skipped', 'text-[var(--muted)]'],
] as const

/** Grade badge, score, per-status counts and "Save HTML report…". */
export default function McpSecuritySummary({ report }: { report: McpSecurityReport }) {
  const { t } = useTranslation()
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)

  const save = async (): Promise<void> => {
    setSaving(true)
    setNote(null)
    try {
      const res = await saveSecurityReportHtml(report)
      if (!res.ok) setNote({ ok: false, text: `${t('mcp.security.exportFailed')}: ${res.error}` })
      else if (res.path)
        setNote({ ok: true, text: `${t('mcp.security.exportSaved')}: ${res.path}` })
    } catch (e) {
      setNote({ ok: false, text: `${t('mcp.security.exportFailed')}: ${(e as Error).message}` })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      data-testid="mcp-security-summary"
      className="flex flex-col gap-2 rounded-md border border-[var(--border)] bg-[var(--surface)] p-3"
    >
      <div className="flex flex-wrap items-center gap-3">
        <div
          data-testid="mcp-security-grade"
          data-grade={report.grade}
          aria-label={`${t('mcp.security.grade')} ${report.grade}`}
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-lg text-[26px] font-extrabold text-white ${GRADE_CLASS[report.grade]}`}
        >
          {report.grade}
        </div>
        <div className="flex min-w-0 flex-col">
          <span className="text-[13px] font-semibold text-[var(--text)]">
            {t('mcp.security.score')}: {report.score}/100
          </span>
          {report.serverInfo && (
            <span className="truncate text-[11px] text-[var(--muted)]">
              {report.serverInfo.name} {report.serverInfo.version} ·{' '}
              {report.serverInfo.protocolVersion}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2.5 text-[12px]">
          {COUNTS.map(([key, cls]) => (
            <span key={key} className={cls}>
              {report.summary[key]} {t(`mcp.security.summary.${key}`)}
            </span>
          ))}
        </div>
        <GhostButton
          onClick={() => void save()}
          disabled={saving}
          data-testid="mcp-security-export"
          className="ml-auto"
        >
          <Download size={13} />
          {t('mcp.security.export')}
        </GhostButton>
      </div>
      {report.error && <p className="m-0 text-[12px] text-[var(--red)]">{report.error}</p>}
      {report.cancelled && (
        <p className="m-0 text-[12px] text-[var(--orange)]">{t('mcp.security.cancelled')}</p>
      )}
      {report.truncated && !report.cancelled && (
        <p className="m-0 text-[12px] text-[var(--orange)]">{t('mcp.security.truncated')}</p>
      )}
      {note && (
        <p
          data-testid="mcp-security-export-note"
          className={`m-0 break-all text-[11px] ${note.ok ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}
        >
          {note.text}
        </p>
      )}
    </div>
  )
}
