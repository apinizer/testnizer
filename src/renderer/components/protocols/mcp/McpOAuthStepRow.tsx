import { useState } from 'react'
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Loader2,
  MinusCircle,
  XCircle,
} from 'lucide-react'
import type { McpOAuthHttpRequest, McpOAuthHttpResponse, McpOAuthStep } from '../../../types/mcp'
import { useTranslation } from '../../../lib/i18n'
import { headerLines } from './oauth-steps'

function StatusIcon({ status }: { status: McpOAuthStep['status'] }) {
  switch (status) {
    case 'running':
      return <Loader2 size={14} className="animate-spin text-[var(--accent)]" />
    case 'passed':
      return <CheckCircle2 size={14} className="text-[var(--green)]" />
    case 'failed':
      return <XCircle size={14} className="text-[var(--red)]" />
    case 'skipped':
      return <MinusCircle size={14} className="text-[var(--muted)]" />
    default:
      return <Circle size={14} className="text-[var(--hint)]" />
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

function requestText(r: McpOAuthHttpRequest): string {
  return [`${r.method} ${r.url}`, headerLines(r.headers), r.body ? `\n${r.body}` : '']
    .filter(Boolean)
    .join('\n')
}

function responseText(r: McpOAuthHttpResponse): string {
  return [`HTTP ${r.status}`, headerLines(r.headers), r.body ? `\n${r.body}` : '']
    .filter(Boolean)
    .join('\n')
}

/** One step of the OAuth debugger: status, title, and an expandable request / response. */
export default function McpOAuthStepRow({ step }: { step: McpOAuthStep }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const titleKey = `mcp.oauth.step.${step.id}`
  const title = t(titleKey) === titleKey ? step.title : t(titleKey)
  const attempts = step.attempts ?? []
  const expandable = !!(step.request || step.response || step.note || step.error)

  return (
    <li
      data-testid={`mcp-oauth-step-${step.index}`}
      data-status={step.status}
      className="rounded-md border border-[var(--border)]"
    >
      <button
        type="button"
        onClick={() => expandable && setOpen((v) => !v)}
        aria-expanded={open}
        disabled={!expandable}
        className="flex w-full cursor-pointer items-center gap-2 border-none bg-transparent px-2.5 py-1.5 text-left text-[12px] text-[var(--text)] disabled:cursor-default"
      >
        <StatusIcon status={step.status} />
        <span className="w-4 shrink-0 text-[var(--muted)]">{step.index}.</span>
        <span className="min-w-0 flex-1 truncate font-medium">{title}</span>
        <span className="shrink-0 text-[11px] text-[var(--muted)]">
          {t(`mcp.oauth.status.${step.status}`)}
          {step.durationMs !== undefined ? ` · ${step.durationMs} ms` : ''}
        </span>
        {expandable &&
          (open ? (
            <ChevronDown size={13} className="text-[var(--muted)]" />
          ) : (
            <ChevronRight size={13} className="text-[var(--muted)]" />
          ))}
      </button>
      {!open && step.error && (
        <p className="m-0 px-2.5 pb-1.5 pl-[34px] text-[11px] text-[var(--red)]">{step.error}</p>
      )}
      {open && (
        <div
          data-testid={`mcp-oauth-step-${step.index}-details`}
          className="flex flex-col gap-2 border-t border-[var(--border)] p-2.5"
        >
          {step.error && <p className="m-0 text-[12px] text-[var(--red)]">{step.error}</p>}
          {step.note && (
            <p className="m-0 break-words text-[12px] text-[var(--muted)]">{step.note}</p>
          )}
          {step.request && (
            <Block label={t('mcp.oauth.request')} text={requestText(step.request)} />
          )}
          {step.response && (
            <Block label={t('mcp.oauth.response')} text={responseText(step.response)} />
          )}
          {attempts.length > 1 && (
            <Block
              label={t('mcp.oauth.attempts').replace('{n}', String(attempts.length))}
              text={attempts
                .map(
                  (a) =>
                    `${a.request.method} ${a.request.url} → ${a.response ? `HTTP ${a.response.status}` : (a.error ?? '—')}`,
                )
                .join('\n')}
            />
          )}
        </div>
      )}
    </li>
  )
}
