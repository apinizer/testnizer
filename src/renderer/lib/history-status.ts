import type { HistoryEntry } from '../types'

/**
 * How a History row's status reads — ONE rule for the History sidebar and the
 * new-request page's Recent endpoints (1.6.0 screen review G-15: a failed
 * MQTT / SSE connect showed a green "-1").
 *
 * What main writes (`src/main/ipc/*.handler.ts` → `historyRepo.addHistory`):
 *   - negative (-1): transport failure on every protocol (SSE, WebSocket,
 *     Socket.IO, MQTT, MCP) → "Error" / "Hata" in the danger colour, the
 *     stored error message as tooltip;
 *   - 0: SUCCESS for MQTT / Socket.IO / MCP connects and gRPC (status OK);
 *     an HTTP-like row (HTTP, GraphQL, SOAP) never succeeds with 0;
 *   - gRPC 1–16: gRPC failure codes → danger colour, the code as label;
 *   - otherwise an HTTP status: 1xx/2xx green, 3xx blue, 4xx orange, 5xx red.
 * No status → no badge (null), unless the row stored an error (then "Error").
 * Colours are theme tokens only.
 */
export interface StatusDisplay {
  label: string
  color: string
  failed: boolean
  /** Tooltip: the stored transport error, when there is one. */
  title?: string
}

const HTTP_LIKE = new Set(['http', 'graphql', 'soap'])

export function historyStatusDisplay(
  entry: Pick<HistoryEntry, 'status_code' | 'protocol' | 'response_snapshot'>,
  t: (key: string) => string,
): StatusDisplay | null {
  const code = entry.status_code
  const protocol = entry.protocol || 'http'
  const error = entry.response_snapshot?.error
  const title = typeof error === 'string' && error ? error : undefined
  const failure = (): StatusDisplay => ({
    label: t('history.statusError'),
    color: 'var(--red)',
    failed: true,
    title,
  })
  // No status: a failure only when the row stored an error, otherwise no badge.
  if (code == null || Number.isNaN(code)) return title ? failure() : null
  if (code < 0) return failure()
  if (code === 0) {
    return HTTP_LIKE.has(protocol)
      ? failure()
      : { label: t('history.statusOk'), color: 'var(--green)', failed: false }
  }
  if (protocol === 'grpc') return { label: String(code), color: 'var(--red)', failed: true, title }
  if (code < 300) return { label: String(code), color: 'var(--green)', failed: false }
  if (code < 400) return { label: String(code), color: 'var(--blue)', failed: false }
  if (code < 500) return { label: String(code), color: 'var(--orange)', failed: true }
  return { label: String(code), color: 'var(--red)', failed: true }
}
