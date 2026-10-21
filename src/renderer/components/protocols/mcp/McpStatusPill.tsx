import { useTranslation } from '../../../lib/i18n'
import { CB_HEIGHT } from '../connection-bar-ui'

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

/**
 * Disconnected / Connecting… / Connected / Error, at the left of the MCP bar
 * (issue #171) — and of the SSE, WebSocket and Socket.IO bars, which reuse it
 * (`testId="sse-status" | "ws-status" | "socketio-status"`, issue #224).
 * Bar height and a base − 1px label (`text-xs`), so it grows with the font
 * size like the URL next to it (`connection-bar-ui.ts`).
 */
export default function McpStatusPill({
  state,
  testId = 'mcp-status',
  labelKey,
}: {
  state: McpConnectionState
  testId?: string
  /** i18n key that replaces the state's own label (the SSE bar's "Reconnecting…"). */
  labelKey?: string
}) {
  const { t } = useTranslation()
  const tone = STATUS_TONE[state] ?? STATUS_TONE.disconnected
  return (
    <span
      data-testid={testId}
      data-state={state}
      role="status"
      className={`flex ${CB_HEIGHT} shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-xs font-medium ${tone.pill}`}
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${tone.dot}`} />
      {t(labelKey ?? tone.key)}
    </span>
  )
}
