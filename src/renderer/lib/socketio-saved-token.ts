// Issue #243 — the Socket.IO bearer token is write-only in localStorage.
//
// `socketio.store` keeps a literal token out of its tab snapshot, so a tab
// restored after a restart comes back with an empty token field and
// `bearerTokenWithheld` set. When that tab is bound to a saved row (endpoint,
// saved request, test-suite item) the token is still on the row: this module
// reads it back. Two callers:
//   - the Workbench's active-tab effect (fire-and-forget) — Connect works
//     after a restart without retyping the token;
//   - `saveActiveRequestInPlace` / Save As (awaited, before the snapshot) — an
//     untouched empty field must never overwrite the token stored on the row.
//
// Unsaved draft tabs have no row to read: their literal token is gone after a
// restart, which the editor's hint says.

import { useSocketIOStore } from '../stores/socketio.store'
import type { Tab } from '../types'

type BoundTab = Pick<Tab, 'id' | 'protocol' | 'endpointId' | 'savedRequestId' | 'testSuiteItemId'>

interface IpcEnvelope<T> {
  success: boolean
  data?: T | null
}

function parseJson(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== 'string' || raw === '') return null
  try {
    const v: unknown = JSON.parse(raw)
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** `metadata.socketio.bearerToken` of a protocol-meta bag; `''` when absent. */
function tokenFromMeta(meta: unknown): string {
  if (!meta || typeof meta !== 'object') return ''
  const sio = (meta as Record<string, unknown>).socketio
  if (!sio || typeof sio !== 'object') return ''
  const token = (sio as Record<string, unknown>).bearerToken
  return typeof token === 'string' ? token : ''
}

/**
 * The token stored on the row `tab` is bound to — `''` when the row has none,
 * `null` when the row could not be read (IPC failure, row missing, malformed
 * JSON). Same row precedence as `saveActiveRequestInPlace`: suite item, saved
 * request, endpoint. Undefined for a tab bound to no row.
 */
export async function readSavedSocketioToken(tab: BoundTab): Promise<string | null | undefined> {
  const api = window.api
  try {
    if (tab.testSuiteItemId) {
      const res = (await api?.testSuiteItem?.get(tab.testSuiteItemId)) as
        | IpcEnvelope<{ request_schema?: string }>
        | undefined
      if (!res?.success || !res.data) return null
      const schema = parseJson(res.data.request_schema || '{}')
      return schema ? tokenFromMeta(schema.metadata) : null
    }
    if (tab.savedRequestId) {
      const res = (await api?.savedRequest?.get(tab.savedRequestId)) as
        | IpcEnvelope<{ metadata?: string | null }>
        | undefined
      if (!res?.success || !res.data) return null
      // A saved request without metadata simply has no token.
      if (!res.data.metadata) return ''
      const meta = parseJson(res.data.metadata)
      return meta ? tokenFromMeta(meta) : null
    }
    if (tab.endpointId) {
      const res = (await api?.endpoint?.get(tab.endpointId)) as
        | IpcEnvelope<{ request_schema?: string }>
        | undefined
      if (!res?.success || !res.data) return null
      if (!res.data.request_schema) return ''
      const schema = parseJson(res.data.request_schema)
      return schema ? tokenFromMeta(schema.metadata) : null
    }
  } catch {
    return null
  }
  return undefined
}

const inflight = new Map<string, Promise<boolean>>()

/**
 * Make sure `tab`'s Socket.IO slice is no longer waiting for a withheld token.
 * Resolves `true` when nothing is withheld any more (reloaded, the user edited
 * the field meanwhile, or the tab is an unsaved draft with no row to protect)
 * and `false` when the row could not be read — the caller must then not save
 * the empty field over the stored token. Concurrent calls for one tab share
 * one read.
 */
export function ensureSocketioTokenLoaded(tab: BoundTab): Promise<boolean> {
  if ((tab.protocol ?? 'http') !== 'socketio') return Promise.resolve(true)
  const store = useSocketIOStore.getState()
  if (!store.isTokenWithheld(tab.id)) return Promise.resolve(true)
  const pending = inflight.get(tab.id)
  if (pending) return pending
  const run = (async (): Promise<boolean> => {
    const token = await readSavedSocketioToken(tab)
    if (token === null) return !useSocketIOStore.getState().isTokenWithheld(tab.id)
    // No row: an unsaved draft — the token is gone, nothing to overwrite.
    useSocketIOStore.getState().applyRestoredToken(tab.id, token ?? '')
    return true
  })().finally(() => inflight.delete(tab.id))
  inflight.set(tab.id, run)
  return run
}
