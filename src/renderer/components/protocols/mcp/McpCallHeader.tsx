import { Check, Copy } from 'lucide-react'
import { useTranslation } from '../../../lib/i18n'
import { useCopy } from '../../../lib/use-copy'
import { formatMcpSize, type McpCallMeta } from '../../../stores/mcp-call.slice'

const PILL: Record<McpCallMeta['status'], { key: string; tone: string }> = {
  ok: { key: 'mcp.call.ok', tone: 'bg-[var(--green-bg)] text-[var(--green)]' },
  toolError: {
    key: 'mcp.call.toolError',
    tone: 'bg-[var(--mb-delete-bg)] text-[var(--mb-delete-fg)]',
  },
  error: { key: 'mcp.call.error', tone: 'bg-[var(--mb-delete-bg)] text-[var(--mb-delete-fg)]' },
  cancelled: { key: 'mcp.call.cancelled', tone: 'bg-[var(--surface)] text-[var(--muted)]' },
}

/**
 * The result header of a tool / resource / prompt call (issue #164), in the
 * gRPC response header's shape: status pill · `NNN ms` · size (HTTP's KB
 * format) · Copy. Nothing until a call has finished.
 */
export default function McpCallHeader({
  meta,
  copyText,
}: {
  meta: McpCallMeta | null
  /** Clipboard text of the result; Copy is hidden without one. */
  copyText?: () => string
}) {
  const { t } = useTranslation()
  const { copied, copy } = useCopy()
  if (!meta) return null
  const pill = PILL[meta.status]
  const canCopy = !!copyText && (meta.status === 'ok' || meta.status === 'toolError')
  return (
    <span data-testid="mcp-call-header" className="flex items-center gap-2 text-[11px]">
      <span
        data-testid="mcp-call-status"
        data-status={meta.status}
        className={`rounded-full px-2 py-0.5 font-semibold ${pill.tone}`}
      >
        {t(pill.key)}
      </span>
      {meta.durationMs !== undefined && (
        <span data-testid="mcp-call-duration" className="text-[var(--muted)]">
          {`${meta.durationMs} ms`}
        </span>
      )}
      {meta.sizeBytes !== undefined && (
        <span data-testid="mcp-call-size" className="text-[var(--hint)]">
          {formatMcpSize(meta.sizeBytes)}
        </span>
      )}
      {canCopy && (
        <button
          type="button"
          data-testid="mcp-call-copy"
          title={copied ? t('mcp.call.copied') : t('mcp.call.copy')}
          aria-label={t('mcp.call.copy')}
          onClick={() => void copy(copyText())}
          className="flex cursor-pointer items-center gap-1 rounded border border-[var(--border)] bg-transparent px-1.5 py-0.5 text-[11px] text-[var(--muted)] hover:bg-[var(--surface)]"
        >
          {copied ? <Check size={11} /> : <Copy size={11} />}
          {copied ? t('mcp.call.copied') : t('mcp.call.copy')}
        </button>
      )}
    </span>
  )
}
