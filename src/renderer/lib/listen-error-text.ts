/**
 * Tester finding 11 — the renderer half of the mock bind-failure text.
 *
 * A mock start / port move that cannot bind its address arrives with main's
 * English `error` AND a structured `errorInfo` (`src/shared/listen-error.ts`,
 * built only in `src/main/lib/listen-address.ts`). This helper words
 * `errorInfo` in the active locale; `kind: 'other'`, a missing / foreign info
 * (old build) or a key this build does not know keep main's text.
 *
 * Pure: no DOM, no store.
 */
import { isListenErrorInfo, type ListenErrorInfo } from '../../shared/listen-error'
import { t } from './i18n'

function keyFor(info: ListenErrorInfo): string | null {
  switch (info.kind) {
    case 'in-use':
      if (!info.by) return 'mock.listen.inUse'
      return info.otherProject ? 'mock.listen.inUseByMockOtherProject' : 'mock.listen.inUseByMock'
    case 'permission':
      return 'mock.listen.permission'
    case 'unavailable':
      return 'mock.listen.unavailable'
    default:
      return null
  }
}

/** Localized text for a bind failure; `fallback` (main's English) when there is none. */
export function describeListenError(info: unknown, fallback: string): string {
  if (!isListenErrorInfo(info)) return fallback
  const key = keyFor(info)
  if (!key) return fallback
  const text = t(key)
  if (text === key) return fallback
  return text
    .replace('{port}', String(info.port))
    .replace('{host}', info.host)
    .replace('{name}', info.by ?? '')
}

/** The reason of a failed mock IPC result, localized when it is a bind failure. */
export function mockIpcErrorText(
  r: { error?: string; errorInfo?: unknown },
  fallback: string,
): string {
  return describeListenError(r.errorInfo, r.error ?? fallback)
}
