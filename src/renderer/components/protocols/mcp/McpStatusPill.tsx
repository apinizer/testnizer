import { useTranslation } from '../../../lib/i18n'

type McpConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'

/** Status pill tones — globals.css tokens only, so both themes follow (issue #171). */
const STATUS_TONE: Record<McpConnectionState, { pill: string; dot: string; key: string }> = {
  disconnected: {
    pill: 'bg-[var(--surface)] text-[var(--muted)]',
    dot: 'bg-[var(--muted)]',
    key: 'mcp.status.disconnected',
  },
  connecting: {
    pill: 'bg-[var(--surface)] text-[var(--orange)]',
    dot: 'bg-[var(--orange)]',
    key: 'mcp.status.connecting',
  },
  connected: {
    pill: 'bg-[var(--green-bg)] text-[var(--green)]',
    dot: 'bg-[var(--green)]',
    key: 'mcp.status.connected',
  },
  error: {
    pill: 'bg-[var(--mb-delete-bg)] text-[var(--red)]',
    dot: 'bg-[var(--red)]',
    key: 'mcp.status.error',
  },
}

/** Disconnected / Connecting… / Connected / Error, at the left of the MCP bar (issue #171). */
export default function McpStatusPill({ state }: { state: McpConnectionState }) {
  const { t } = useTranslation()
  const tone = STATUS_TONE[state] ?? STATUS_TONE.disconnected
  return (
    <span
      data-testid="mcp-status"
      data-state={state}
      role="status"
      className={`flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium ${tone.pill}`}
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${tone.dot}`} />
      {t(tone.key)}
    </span>
  )
}
