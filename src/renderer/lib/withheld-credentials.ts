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
//
// The same read rehydrates a tab whose whole state is missing — dropped by the
// request store's cache cap or absent from the startup snapshot (`unloaded` /
// `unloadedProtocol`, P0 data loss: Ctrl+S used to write the empty state over
// the row). Such a tab is treated as fully withheld; see "Not-loaded tabs".

import { useRequestStore } from '../stores/request.store'
import { useMcpStore } from '../stores/mcp.store'
import { useWebSocketStore, WS_CREDENTIALS } from '../stores/websocket.store'
import { useSseStore, SSE_CREDENTIALS } from '../stores/sse.store'
import { useGraphQLStore } from '../stores/graphql.store'
import { useGrpcStore, GRPC_CREDENTIALS } from '../stores/grpc.store'
import { useSocketIOStore, SIO_CREDENTIALS } from '../stores/socketio.store'
import { useSoapStore, SOAP_CREDENTIALS } from '../stores/soap.store'
import { HTTP_CREDENTIALS } from '../stores/request.store'
import { MCP_CREDENTIALS } from '../stores/mcp.store'
import { GQL_CREDENTIALS } from '../stores/graphql.store'
import { restoreWithheld, type CredentialSpec, type WithheldState } from './credential-withhold'
import { useTabsStore } from '../stores/tabs.store'
import {
  requestStoreSettings,
  restoreProtocolFromMetadata,
  restoreRequestSettings,
} from './save-active-request'
import { readRequestSettings } from '../../shared/request-settings'
import type {
  AuthConfig,
  HttpMethod,
  KeyValuePair,
  RequestBody,
  Tab,
  TestAssertion,
} from '../types'

type BoundTab = Pick<Tab, 'id' | 'protocol' | 'endpointId' | 'savedRequestId' | 'testSuiteItemId'>

/**
 * A saved row, normalized across the three tables: `request` holds the
 * request-store fields (`url`, `params`, `body`, `auth`, `headers`, …) —
 * `request_schema` (+ the suite item's `url` column) for an endpoint / suite
 * item, the matching columns for a saved request — and `meta` the protocol
 * blocks (`{ mcp: {…}, websocket: {…} }`).
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

function fromSchema(rawSchema: unknown, url?: unknown): BoundRow | null {
  const schema = parseObject(rawSchema)
  if (!schema) return null
  // A suite item keeps its URL in a column, not in `request_schema`.
  const request = typeof url === 'string' && schema.url === undefined ? { ...schema, url } : schema
  return { request, meta: isRecord(schema.metadata) ? schema.metadata : {} }
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
        | IpcEnvelope<{
            request_schema?: string
            url?: string | null
            method?: string | null
            assertions?: string | null
          }>
        | undefined
      if (!res?.success || !res.data) return null
      const row = fromSchema(res.data.request_schema, res.data.url ?? undefined)
      // A suite item keeps its method and assertions in columns of their own.
      const assertions = parseColumn(res.data.assertions)
      if (!row || !assertions.ok) return null
      if (typeof res.data.method === 'string' && row.request.method === undefined) {
        row.request = { ...row.request, method: res.data.method }
      }
      if (assertions.value !== undefined)
        row.request = { ...row.request, assertions: assertions.value }
      return row
    }
    if (tab.savedRequestId) {
      const res = (await api?.savedRequest?.get(tab.savedRequestId)) as
        | IpcEnvelope<{
            url?: string
            method?: string
            params?: string
            body?: string | null
            headers?: string
            auth?: string
            pre_script?: string | null
            post_script?: string | null
            assertions?: string | null
            metadata?: string | null
          }>
        | undefined
      if (!res?.success || !res.data) return null
      const params = parseColumn(res.data.params)
      const body = parseColumn(res.data.body)
      const headers = parseColumn(res.data.headers)
      const auth = parseColumn(res.data.auth)
      const assertions = parseColumn(res.data.assertions)
      const meta = parseObject(res.data.metadata)
      if (!params.ok || !body.ok || !headers.ok || !auth.ok || !assertions.ok || !meta) return null
      const request: Record<string, unknown> = {
        // Timeout / redirects / SSL ride at the top of `metadata` on this
        // table (#185) — lifted here so `request` reads like a request_schema.
        ...readRequestSettings(meta),
        params: params.value,
        body: body.value,
        headers: headers.value,
        auth: auth.value,
        preScript: res.data.pre_script ?? '',
        postScript: res.data.post_script ?? '',
        assertions: assertions.value,
      }
      if (typeof res.data.url === 'string') request.url = res.data.url
      if (typeof res.data.method === 'string') request.method = res.data.method
      return { request, meta }
    }
    if (tab.endpointId) {
      const res = (await api?.endpoint?.get(tab.endpointId)) as
        | IpcEnvelope<{ request_schema?: string; path?: string; method?: string }>
        | undefined
      if (!res?.success || !res.data) return null
      const row = fromSchema(res.data.request_schema, res.data.path)
      // Same fallback as `openEndpointTab`: the row's method when the schema has none.
      if (row && row.request.method === undefined && typeof res.data.method === 'string') {
        row.request = { ...row.request, method: res.data.method }
      }
      return row
    }
  } catch {
    return null
  }
  return undefined
}

// ─── Adapters ───────────────────────────────────────────────────────────

interface WithheldAdapter {
  /** Names what could not be reloaded, in the refusal message. */
  label: string | ((tabId: string) => string)
  /** Only tabs of this protocol; omitted = every tab. */
  protocol?: string
  pending: (tabId: string) => boolean
  /** Put the row's values back (`undefined` = no row: forget the marker). */
  restore: (tab: BoundTab, row: BoundRow | undefined) => void
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
  /** The store's spec — needed for its `texts` (issue #247). */
  spec?: CredentialSpec,
): WithheldAdapter {
  const slice = (tabId: string): T | undefined => {
    const s = store.getState()
    return s._currentTabId === tabId ? s : s._tabStates.get(tabId)
  }
  return {
    label,
    protocol,
    pending: (tabId) => (slice(tabId)?.withheldCredentials?.length ?? 0) > 0,
    restore: ({ id: tabId }, row) => {
      const s = store.getState()
      const src = row ? source(row) : undefined
      if (s._currentTabId === tabId) {
        store.setState(restoreWithheld<T>(s, src, spec))
        return
      }
      const cached = s._tabStates.get(tabId)
      if (!cached) return
      const map = new Map(s._tabStates)
      map.set(tabId, { ...cached, ...restoreWithheld(cached, src, spec) })
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

// ─── Not-loaded tabs ────────────────────────────────────────────────────
//
// A tab bound to a saved row whose request-store slice was dropped by the
// cache cap, or was missing from the snapshot at startup, is `unloaded`; one
// whose protocol store slice was missing at startup is `unloadedProtocol`
// (request.store / activate-tab.ts). It is a fully withheld tab: the same one
// row read puts it all back. Until then an in-place save is refused.

type RequestSlice = {
  unloaded?: boolean
  unloadedProtocol?: boolean
}

function requestSlice(tabId: string): RequestSlice | undefined {
  const s = useRequestStore.getState()
  return s._currentTabId === tabId ? s : s._tabStates.get(tabId)
}

/** The tab's state was never loaded from its saved row. */
export function isTabUnloaded(tabId: string): boolean {
  const slice = requestSlice(tabId)
  return !!(slice?.unloaded || slice?.unloadedProtocol)
}

const arrayOr = <T>(v: unknown, fallback: T[]): T[] => (Array.isArray(v) ? (v as T[]) : fallback)
const objectOr = <T>(v: unknown, fallback: T): T => (isRecord(v) ? (v as T) : fallback)
const stringOr = (v: unknown, fallback: string): string => (typeof v === 'string' ? v : fallback)

/**
 * Fill the not-loaded parts of `tab` from `row` — the request store (same
 * defaults as `openEndpointTab`) and/or the protocol store. Only on the live
 * slice of the active tab: both restores write whatever tab is live, so after
 * a switch away the flags stay and the next activation reloads.
 */
function reloadUnloadedTab(tab: BoundTab, row: BoundRow | undefined): void {
  const req = useRequestStore.getState()
  if (!row) {
    // No row (an unsaved draft): nothing to load, nothing to protect.
    if (req._currentTabId === tab.id)
      useRequestStore.setState({ unloaded: false, unloadedProtocol: false })
    return
  }
  if (req._currentTabId !== tab.id || useTabsStore.getState().activeTabId !== tab.id) return
  const protocol = (tab.protocol ?? 'http') as string
  const r = row.request
  const settings = readRequestSettings(r)
  if (req.unloaded) {
    req.loadFromEndpoint(
      {
        method: stringOr(r.method, 'GET') as HttpMethod,
        url: stringOr(r.url, ''),
        params: arrayOr<KeyValuePair>(r.params, []),
        headers: arrayOr<KeyValuePair>(r.headers, []),
        body: objectOr<RequestBody>(r.body, { type: 'none' }),
        auth: objectOr<AuthConfig>(r.auth, { type: 'none' }),
        preScript: stringOr(r.preScript, ''),
        postScript: stringOr(r.postScript, ''),
        assertions: arrayOr<TestAssertion>(r.assertions, []),
        ...requestStoreSettings(settings),
      },
      // Nothing on the slice to keep — it was never loaded.
      { force: true },
    )
  }
  if (useRequestStore.getState().unloadedProtocol) {
    restoreRequestSettings(protocol, settings)
    restoreProtocolFromMetadata(protocol, row.meta)
  }
  useRequestStore.setState({ unloaded: false, unloadedProtocol: false })
}

const requestTabbed = tabbedAdapter(
  'request credentials',
  undefined,
  asTabbed(useRequestStore),
  (row) => row.request,
  HTTP_CREDENTIALS,
)

const ADAPTERS: WithheldAdapter[] = [
  // The request store backs every tab — Ctrl+S writes its auth + headers for
  // every protocol — so it is not gated on HTTP. It also carries the
  // not-loaded flags: a not-loaded tab is reloaded whole, which covers its
  // withheld values too.
  {
    label: (tabId) => (isTabUnloaded(tabId) ? 'request' : 'request credentials'),
    protocol: undefined,
    pending: (tabId) => isTabUnloaded(tabId) || requestTabbed.pending(tabId),
    restore: (tab, row) =>
      isTabUnloaded(tab.id) ? reloadUnloadedTab(tab, row) : requestTabbed.restore(tab, row),
  },
  tabbedAdapter('MCP credentials', 'mcp', asTabbed(useMcpStore), metaBlock('mcp'), MCP_CREDENTIALS),
  tabbedAdapter(
    'WebSocket credentials',
    'websocket',
    asTabbed(useWebSocketStore),
    metaBlock('websocket'),
    WS_CREDENTIALS,
  ),
  tabbedAdapter('SSE credentials', 'sse', asTabbed(useSseStore), metaBlock('sse'), SSE_CREDENTIALS),
  tabbedAdapter(
    'GraphQL credentials',
    'graphql',
    asTabbed(useGraphQLStore),
    metaBlock('graphql'),
    GQL_CREDENTIALS,
  ),
  tabbedAdapter(
    'gRPC credentials',
    'grpc',
    asTabbed(useGrpcStore),
    metaBlock('grpc'),
    GRPC_CREDENTIALS,
  ),
  // WS-Security UsernameToken password, pasted private keys, the URLs (issue #247).
  tabbedAdapter(
    'SOAP credentials',
    'soap',
    asTabbed(useSoapStore),
    metaBlock('soap'),
    SOAP_CREDENTIALS,
  ),
  // The connection URL (issue #247) — the generic marker.
  tabbedAdapter(
    'Socket.IO URL',
    'socketio',
    asTabbed(useSocketIOStore),
    metaBlock('socketio'),
    SIO_CREDENTIALS,
  ),
  // The bearer token keeps its own single-field marker (issue #243).
  {
    label: 'Socket.IO bearer token',
    protocol: 'socketio',
    pending: (tabId) => useSocketIOStore.getState().isTokenWithheld(tabId),
    restore: ({ id: tabId }, row) => {
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

/** The refusal when a not-loaded tab is still not loaded (in-place save guard). */
export const NOT_LOADED_ERROR = 'Could not reload the saved request; the request was not saved.'

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
      const what = waiting
        .map((a) => (typeof a.label === 'function' ? a.label(tab.id) : a.label))
        .join(', ')
      return {
        ok: false,
        error: `Could not reload the saved ${what}; the request was not saved.`,
      }
    }
    for (const a of waiting) a.restore(tab, row)
    // A not-loaded tab is reloaded only while it is the live one; the user
    // switched away during the read — the next activation retries.
    if (isTabUnloaded(tab.id)) return { ok: false, error: NOT_LOADED_ERROR }
    return { ok: true }
  })().finally(() => inflight.delete(tab.id))
  inflight.set(tab.id, run)
  return run
}
