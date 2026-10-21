// Issues #243 / #244 — reload withheld credentials from the saved row.
//
// No tab snapshot in localStorage holds a literal credential: the stores blank
// it and mark the path (`lib/credential-withhold.ts`, Socket.IO's own
// `bearerTokenWithheld`). A tab restored after a restart therefore comes back
// with empty credential fields. When the tab is bound to a saved row
// (endpoint, saved request, test-suite item) the values are still on the row,
// and this module reads them back — ONE row read per tab, one adapter per
// store. Callers:
//   - the Workbench's active-tab effect (fire-and-forget) — Send / Connect
//     work after a restart without retyping;
//   - `saveActiveRequestInPlace` / Save As (awaited, before the snapshot) — an
//     untouched empty field must never overwrite the value stored on the row.
//
// Unsaved draft tabs have no row: their literal credentials are gone after a
// restart, which the Auth / MCP Authorization / Socket.IO hints say. Run reads
// the DB and is unaffected.

import { useRequestStore } from '../stores/request.store'
import { useMcpStore } from '../stores/mcp.store'
import { useWebSocketStore } from '../stores/websocket.store'
import { useSseStore } from '../stores/sse.store'
import { useGraphQLStore } from '../stores/graphql.store'
import { useGrpcStore } from '../stores/grpc.store'
import { useSocketIOStore } from '../stores/socketio.store'
import { restoreWithheld, type WithheldState } from './credential-withhold'
import type { Tab } from '../types'

type BoundTab = Pick<Tab, 'id' | 'protocol' | 'endpointId' | 'savedRequestId' | 'testSuiteItemId'>

/**
 * A saved row, normalized across the three tables: `request` holds the
 * request-store fields (`auth`, `headers`, …) — `request_schema` for an
 * endpoint / suite item, the `auth` / `headers` columns for a saved request —
 * and `meta` the protocol blocks (`{ mcp: {…}, websocket: {…} }`).
 */
export interface BoundRow {
  request: Record<string, unknown>
  meta: Record<string, unknown>
}

interface IpcEnvelope<T> {
  success: boolean
  data?: T | null
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** JSON object text → object; `{}` for empty; `null` when malformed. */
function parseObject(raw: unknown): Record<string, unknown> | null {
  if (raw === undefined || raw === null || raw === '') return {}
  if (typeof raw !== 'string') return null
  try {
    const v: unknown = JSON.parse(raw)
    return isRecord(v) ? v : null
  } catch {
    return null
  }
}

/** JSON column text → value; undefined for empty; `null` marker when malformed. */
function parseColumn(raw: unknown): { ok: true; value: unknown } | { ok: false } {
  if (raw === undefined || raw === null || raw === '') return { ok: true, value: undefined }
  if (typeof raw !== 'string') return { ok: false }
  try {
    return { ok: true, value: JSON.parse(raw) as unknown }
  } catch {
    return { ok: false }
  }
}

function fromSchema(rawSchema: unknown): BoundRow | null {
  const schema = parseObject(rawSchema)
  if (!schema) return null
  return { request: schema, meta: isRecord(schema.metadata) ? schema.metadata : {} }
}

/**
 * The row `tab` is bound to — `null` when it could not be read (IPC failure,
 * row missing, malformed JSON), `undefined` for a tab bound to no row. Same
 * row precedence as `saveActiveRequestInPlace`: suite item, saved request,
 * endpoint.
 */
export async function readBoundRow(tab: BoundTab): Promise<BoundRow | null | undefined> {
  const api = window.api
  try {
    if (tab.testSuiteItemId) {
      const res = (await api?.testSuiteItem?.get(tab.testSuiteItemId)) as
        | IpcEnvelope<{ request_schema?: string }>
        | undefined
      if (!res?.success || !res.data) return null
      return fromSchema(res.data.request_schema)
    }
    if (tab.savedRequestId) {
      const res = (await api?.savedRequest?.get(tab.savedRequestId)) as
        | IpcEnvelope<{ headers?: string; auth?: string; metadata?: string | null }>
        | undefined
      if (!res?.success || !res.data) return null
      const headers = parseColumn(res.data.headers)
      const auth = parseColumn(res.data.auth)
      const meta = parseObject(res.data.metadata)
      if (!headers.ok || !auth.ok || !meta) return null
      return { request: { headers: headers.value, auth: auth.value }, meta }
    }
    if (tab.endpointId) {
      const res = (await api?.endpoint?.get(tab.endpointId)) as
        | IpcEnvelope<{ request_schema?: string }>
        | undefined
      if (!res?.success || !res.data) return null
      return fromSchema(res.data.request_schema)
    }
  } catch {
    return null
  }
  return undefined
}

// ─── Adapters ───────────────────────────────────────────────────────────

interface WithheldAdapter {
  /** Names what could not be reloaded, in the refusal message. */
  label: string
  /** Only tabs of this protocol; omitted = every tab. */
  protocol?: string
  pending: (tabId: string) => boolean
  /** Put the row's values back (`undefined` = no row: forget the marker). */
  restore: (tabId: string, row: BoundRow | undefined) => void
}

interface TabbedStore<T extends WithheldState> {
  getState: () => T & { _currentTabId: string | null; _tabStates: Map<string, T> }
  setState: (patch: Partial<T> & { _tabStates?: Map<string, T> }) => void
}

/**
 * The adapter of a store built on `credential-withhold.ts`: the marker is the
 * tab slice's `withheldCredentials` (live slice = the store root, other tabs
 * = `_tabStates`), `source` picks the object whose paths mirror the slice's.
 * Applied with `setState` — a restore is not an edit, the dirty dot stays.
 */
function tabbedAdapter<T extends WithheldState>(
  label: string,
  protocol: string | undefined,
  store: TabbedStore<T>,
  source: (row: BoundRow) => unknown,
): WithheldAdapter {
  const slice = (tabId: string): T | undefined => {
    const s = store.getState()
    return s._currentTabId === tabId ? s : s._tabStates.get(tabId)
  }
  return {
    label,
    protocol,
    pending: (tabId) => (slice(tabId)?.withheldCredentials?.length ?? 0) > 0,
    restore: (tabId, row) => {
      const s = store.getState()
      const src = row ? source(row) : undefined
      if (s._currentTabId === tabId) {
        store.setState(restoreWithheld<T>(s, src))
        return
      }
      const cached = s._tabStates.get(tabId)
      if (!cached) return
      const map = new Map(s._tabStates)
      map.set(tabId, { ...cached, ...restoreWithheld(cached, src) })
      store.setState({ _tabStates: map } as Partial<T> & { _tabStates: Map<string, T> })
    },
  }
}

const metaBlock =
  (key: string) =>
  (row: BoundRow): unknown =>
    row.meta[key]

/** Typed as the generic shape the adapter needs; each store's slice extends WithheldState. */
function asTabbed<T extends WithheldState>(store: unknown): TabbedStore<T> {
  return store as TabbedStore<T>
}

const ADAPTERS: WithheldAdapter[] = [
  // The request store backs every tab — Ctrl+S writes its auth + headers for
  // every protocol — so it is not gated on HTTP.
  tabbedAdapter('request credentials', undefined, asTabbed(useRequestStore), (row) => row.request),
  tabbedAdapter('MCP credentials', 'mcp', asTabbed(useMcpStore), metaBlock('mcp')),
  tabbedAdapter(
    'WebSocket header values',
    'websocket',
    asTabbed(useWebSocketStore),
    metaBlock('websocket'),
  ),
  tabbedAdapter('SSE header values', 'sse', asTabbed(useSseStore), metaBlock('sse')),
  tabbedAdapter(
    'GraphQL header values',
    'graphql',
    asTabbed(useGraphQLStore),
    metaBlock('graphql'),
  ),
  tabbedAdapter('gRPC metadata values', 'grpc', asTabbed(useGrpcStore), metaBlock('grpc')),
  // Socket.IO keeps its own single-field marker (issue #243).
  {
    label: 'Socket.IO bearer token',
    protocol: 'socketio',
    pending: (tabId) => useSocketIOStore.getState().isTokenWithheld(tabId),
    restore: (tabId, row) => {
      const sio = row?.meta.socketio
      const token = isRecord(sio) && typeof sio.bearerToken === 'string' ? sio.bearerToken : ''
      useSocketIOStore.getState().applyRestoredToken(tabId, token)
    },
  },
]

function adaptersFor(tab: BoundTab): WithheldAdapter[] {
  const protocol = tab.protocol ?? 'http'
  return ADAPTERS.filter((a) => (!a.protocol || a.protocol === protocol) && a.pending(tab.id))
}

export type WithheldReload = { ok: true } | { ok: false; error: string }

const inflight = new Map<string, Promise<WithheldReload>>()

/**
 * Make sure no store still waits for a withheld credential of `tab`.
 * Resolves `{ ok: true }` when nothing is withheld any more (reloaded, the
 * user edited the field meanwhile — that wins, or an unsaved draft with no row
 * to protect) and `{ ok: false, error }` when the row could not be read — the
 * caller must then not save the empty fields over the stored values.
 * Concurrent calls for one tab share one read.
 */
export function ensureWithheldCredentialsLoaded(tab: BoundTab): Promise<WithheldReload> {
  if (adaptersFor(tab).length === 0) return Promise.resolve({ ok: true })
  const pending = inflight.get(tab.id)
  if (pending) return pending
  const run = (async (): Promise<WithheldReload> => {
    const row = await readBoundRow(tab)
    // Re-check after the await: an edit meanwhile may have cleared a marker.
    const waiting = adaptersFor(tab)
    if (row === null) {
      if (waiting.length === 0) return { ok: true }
      const what = waiting.map((a) => a.label).join(', ')
      return {
        ok: false,
        error: `Could not reload the saved ${what}; the request was not saved.`,
      }
    }
    for (const a of waiting) a.restore(tab.id, row)
    return { ok: true }
  })().finally(() => inflight.delete(tab.id))
  inflight.set(tab.id, run)
  return run
}
