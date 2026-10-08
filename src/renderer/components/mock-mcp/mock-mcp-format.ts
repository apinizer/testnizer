/**
 * Small display helpers for the Mock MCP UI (issue #140). Kept out of the
 * component files so those export components only (fast refresh).
 */
import type { MockMcpEra, MockMcpLogEntry, MockMcpServerStatus } from '../../types/mock-mcp'

/** i18n keys per live status — literal so the key-coverage test sees them. */
export const STATUS_KEYS: Record<MockMcpServerStatus, string> = {
  running: 'mockMcp.status.running',
  starting: 'mockMcp.status.starting',
  error: 'mockMcp.status.error',
  stopped: 'mockMcp.status.stopped',
}

/**
 * The editor's save chord (Ctrl/Cmd+S). A numeric field commits its pending
 * text on it BEFORE the keydown bubbles to the editor's save handler —
 * otherwise Ctrl+S saves the draft without the number still being typed.
 */
export function isSaveChord(e: {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
}): boolean {
  return (e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 's'
}

/** `HH:MM:SS.mmm` local time of a log entry. */
export function logTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number, w = 2): string => String(n).padStart(w, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
}

/** "ok", the JSON-RPC error code, or the HTTP status the request was answered with. */
export function logOutcome(e: MockMcpLogEntry): string {
  if (e.httpStatus !== undefined && e.httpStatus >= 400) return `HTTP ${e.httpStatus}`
  if (!e.ok) return e.errorCode !== undefined ? String(e.errorCode) : 'error'
  return 'ok'
}

/** i18n keys per protocol era a running server answers (issue #152). */
export const ERA_KEYS: Record<MockMcpEra, string> = {
  modern: 'mockMcp.eras.modern',
  legacy: 'mockMcp.eras.legacy',
}

/** Modern first, then legacy — stable order whatever the backend sends. */
export function sortEras(eras: readonly MockMcpEra[]): MockMcpEra[] {
  return [...eras].sort((a, b) => (a === b ? 0 : a === 'modern' ? -1 : 1))
}
