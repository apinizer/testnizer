/**
 * Issue #253 — the renderer half of the ONE connection-error format.
 *
 * A failed connect (WebSocket, Socket.IO, SSE, MCP, MQTT) arrives with the
 * English `error` string AND the classified `errorInfo`. This helper writes
 * `errorInfo` in the active locale: `<what>[ (HTTP n)][ — host:port][: detail][. hint]`,
 * `what` / `hint` from `connError.<kind>.*`. The composition is the shared one
 * main uses, so the English text equals main's `error` string.
 *
 * Pure: no DOM, no store — safe to import from node-env store tests.
 */
import {
  composeConnectionMessage,
  isConnectionErrorInfo,
  joinConnectionHint,
  type ConnectionErrorInfo,
} from '../../shared/connection-error'
import { t } from './i18n'

export type { ConnectionErrorInfo } from '../../shared/connection-error'

/** Localized one-liner for `info`; `fallback` (or '') when there is none (old build / non-connection failure). */
export function describeConnectionError(
  info: ConnectionErrorInfo | null | undefined,
  fallback?: string,
): string {
  if (!isConnectionErrorInfo(info)) return fallback ?? ''
  const whatKey = `connError.${info.kind}.what`
  const hintKey = `connError.${info.kind}.hint`
  const whatText = t(whatKey)
  // A key this build does not know (newer main) → main's English text.
  if (whatText === whatKey) return joinConnectionHint(info.message, info.hint)
  const hintText = t(hintKey)
  return joinConnectionHint(
    composeConnectionMessage(info, whatText),
    hintText === hintKey ? undefined : hintText,
  )
}

/** A connect result / event payload → its localized error text (`errorInfo` first, then `error`). */
export function connectErrorText(
  res: { error?: unknown; errorInfo?: unknown } | null | undefined,
  fallback: string,
): string {
  const raw = typeof res?.error === 'string' && res.error ? res.error : fallback
  const info = res?.errorInfo
  return isConnectionErrorInfo(info) ? describeConnectionError(info, raw) : raw
}
