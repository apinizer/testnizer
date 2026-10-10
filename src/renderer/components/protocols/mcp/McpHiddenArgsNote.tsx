import { EyeOff } from 'lucide-react'
import { useMcpStore } from '../../../stores/mcp.store'
import { useTranslation } from '../../../lib/i18n'

/**
 * Review item 1b: arguments History stored masked come back EMPTY (never the
 * mask — re-running would send it), and this note says which ones to type
 * again. Each name goes as soon as the user enters a value.
 */
export default function McpHiddenArgsNote() {
  const { t } = useTranslation()
  const hidden = useMcpStore((s) => s.hiddenArgs)
  if (!hidden || hidden.length === 0) return null
  return (
    <div
      data-testid="mcp-hidden-args"
      role="note"
      className="mb-2 flex items-start gap-1.5 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-[12px] text-[var(--muted)]"
    >
      <EyeOff size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
      <span>
        {t('mcp.history.hiddenArg')}:{' '}
        <span className="font-mono text-[var(--text)]">{hidden.join(', ')}</span>
      </span>
    </div>
  )
}
