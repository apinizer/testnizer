/**
 * Why a mock listener could not bind its address (tester finding 11) — sent
 * from main next to the English `error` text so the renderer words it in the
 * user's language (`src/renderer/lib/listen-error-text.ts`). Main builds it in
 * ONE place: `src/main/lib/listen-address.ts`.
 *
 * `by` names the mock (HTTP or MCP) holding the port; `otherProject` says that
 * mock belongs to a project the user is not looking at. `kind: 'other'`
 * carries no wording of its own — the renderer shows main's text.
 */
export type ListenErrorKind = 'in-use' | 'permission' | 'unavailable' | 'other'

export interface ListenErrorInfo {
  kind: ListenErrorKind
  host: string
  port: number
  by?: string
  otherProject?: true
}

/** A refused / failed bind: English text (logs, tests) + the structured reason. */
export interface ListenFailure {
  error: string
  errorInfo: ListenErrorInfo
}

const KINDS: readonly ListenErrorKind[] = ['in-use', 'permission', 'unavailable', 'other']

/** Narrow an IPC payload field (renderer side: data from main is `unknown`). */
export function isListenErrorInfo(v: unknown): v is ListenErrorInfo {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return (
    KINDS.includes(o.kind as ListenErrorKind) &&
    typeof o.host === 'string' &&
    typeof o.port === 'number'
  )
}
