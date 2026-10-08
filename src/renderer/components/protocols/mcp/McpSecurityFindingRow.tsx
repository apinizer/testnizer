import { useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Info,
  MinusCircle,
  XCircle,
} from 'lucide-react'
import type { McpSecurityFinding } from '../../../types/mcp'
import { useTranslation } from '../../../lib/i18n'
import { SEVERITY_CLASS, requestText, responseText, translated } from './security-ui'

function StatusIcon({ status }: { status: McpSecurityFinding['status'] }) {
  switch (status) {
    case 'pass':
      return <CheckCircle2 size={14} className="shrink-0 text-[var(--green)]" />
    case 'warn':
      return <AlertTriangle size={14} className="shrink-0 text-[var(--orange)]" />
    case 'fail':
      return <XCircle size={14} className="shrink-0 text-[var(--red)]" />
    case 'info':
      return <Info size={14} className="shrink-0 text-[var(--blue)]" />
    default:
      return <MinusCircle size={14} className="shrink-0 text-[var(--muted)]" />
  }
}

function Block({ label, text }: { label: string; text: string }) {
  if (!text) return null
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
        {label}
      </span>
      <pre className="m-0 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded border border-[var(--border)] bg-[var(--surface)] p-2 font-mono text-[11px] text-[var(--text)]">
        {text}
      </pre>
    </div>
  )
}

/** One check of the scan: status, severity, title, detail; evidence on demand. */
export default function McpSecurityFindingRow({ finding }: { finding: McpSecurityFinding }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const title = translated(t, `mcp.security.check.${finding.id}`, finding.title)
  const e = finding.evidence
  const refs = (finding.refs ?? []).filter((r) => /^https?:\/\//i.test(r))
  const expandable = !!(e || finding.recommendation || refs.length)
  const problem = finding.status === 'fail' || finding.status === 'warn'

  return (
    <li
      data-testid={`mcp-security-finding-${finding.id}`}
      data-status={finding.status}
      data-severity={finding.severity}
      className="rounded-md border border-[var(--border)]"
    >
      <button
        type="button"
        onClick={() => expandable && setOpen((v) => !v)}
        aria-expanded={open}
        disabled={!expandable}
        className="flex w-full cursor-pointer items-center gap-2 border-none bg-transparent px-2.5 py-1.5 text-left text-[12px] text-[var(--text)] disabled:cursor-default"
      >
        <StatusIcon status={finding.status} />
        <span className="min-w-0 flex-1 truncate font-medium">{title}</span>
        {problem && (
          <span
            className={`shrink-0 rounded border px-1.5 text-[10px] font-semibold uppercase ${SEVERITY_CLASS[finding.severity]}`}
          >
            {t(`mcp.security.severity.${finding.severity}`)}
          </span>
        )}
        <span className="shrink-0 text-[11px] text-[var(--muted)]">
          {t(`mcp.security.status.${finding.status}`)}
        </span>
        {expandable &&
          (open ? (
            <ChevronDown size={13} className="text-[var(--muted)]" />
          ) : (
            <ChevronRight size={13} className="text-[var(--muted)]" />
          ))}
      </button>
      <p className="m-0 break-words px-2.5 pb-1.5 pl-[30px] text-[11px] text-[var(--muted)]">
        {finding.detail}
      </p>
      {open && (
        <div
          data-testid={`mcp-security-finding-${finding.id}-details`}
          className="flex flex-col gap-2 border-t border-[var(--border)] p-2.5"
        >
          {finding.recommendation && (
            <p className="m-0 text-[12px] text-[var(--text)]">
              <span className="font-semibold">{t('mcp.security.recommendation')}: </span>
              {finding.recommendation}
            </p>
          )}
          {e?.matches && e.matches.length > 0 && (
            <Block label={t('mcp.security.matches')} text={e.matches.join('\n')} />
          )}
          {e && <Block label={t('mcp.security.request')} text={requestText(e)} />}
          {e && <Block label={t('mcp.security.response')} text={responseText(e)} />}
          {refs.length > 0 && (
            <div className="flex flex-col gap-0.5 text-[11px]">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                {t('mcp.security.refs')}
              </span>
              {refs.map((r) => (
                <a
                  key={r}
                  href={r}
                  target="_blank"
                  rel="noreferrer"
                  className="break-all text-[var(--accent)]"
                >
                  {r}
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </li>
  )
}
