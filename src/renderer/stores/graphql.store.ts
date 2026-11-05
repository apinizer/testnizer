import { create } from 'zustand'
import type { KeyValuePair, ApiResponse } from '../types'
import { useResponseStore } from './response.store'
import { useTabsStore } from './tabs.store'
import { useEnvironmentStore } from './environment.store'
import { useWorkspaceStore } from './workspace.store'
import { useRequestStore } from './request.store'
import { loadInheritedNetwork, networkPayload } from '../lib/network-settings'
import { resolveVariables, resolveKeyValuePairs } from '../lib/variable-resolver'
import { loadTabbedState, attachTabbedPersist } from '../lib/persist-helpers'
import { reloadedOnSameTab } from '../lib/withheld-before-send'
import { cloneTabSlice } from '../lib/tab-clone'
import { patchTabSlice, readTabSlice, updateTabSlice, withoutTab } from '../lib/tab-slice'
import {
  credentialRows,
  trackCredentialEdits,
  withholdCredentials,
  type CredentialSpec,
  type WithheldState,
} from '../lib/credential-withhold'
import { jsonCredentialText, urlCredentialText } from '../lib/credential-text'
import { makeId } from '../lib/utils'
import { graphqlMaskedSendError } from '../lib/masked-send-guard'
import { t } from '../lib/i18n'
import { subscriptionFailureText, type SubscriptionEnd } from '../lib/graphql-subscription-text'
import { bindConnectionsToProject, releaseConnection } from '../lib/realtime-connections'
import { chooseGraphqlOperation } from '../../shared/graphql-row'
import { graphqlJson } from '../../shared/codegen/normalize'
import { GQL_MAX_SUBSCRIPTION_EVENTS, parseConnectionInit } from '../../shared/graphql-ws'
// Shared dirty-flag helper — flags the active tab's blue dot on a user edit so
// the unsaved-change indicator works for GraphQL, not just HTTP (issue #8).
import { markActiveTabDirty } from '../lib/mark-dirty'

function defaultKv(key = '', value = '', enabled = true): KeyValuePair {
  return { id: makeId(), key, value, enabled }
}

// ─── Schema types ────────────────────────────────────────────

export interface GqlField {
  name: string
  type: string
  args: GqlArg[]
  description?: string
}

export interface GqlArg {
  name: string
  type: string
  description?: string
}

export interface GqlType {
  name: string
  kind: 'OBJECT' | 'INPUT_OBJECT' | 'ENUM' | 'SCALAR' | 'INTERFACE' | 'UNION'
  fields: GqlField[]
  description?: string
  enumValues?: string[]
}

export interface GqlSchema {
  queryType: string | null
  mutationType: string | null
  subscriptionType: string | null
  types: GqlType[]
}

// ─── Subscription event ──────────────────────────────────────

export interface GqlSubscriptionEvent {
  id: string
  /** `data`: a server frame. `error`: a server error. */
  kind: 'data' | 'error'
  data: string
  timestamp: number
}

// ─── Store ───────────────────────────────────────────────────

type SubscriptionState = 'disconnected' | 'connecting' | 'connected' | 'error'

/**
 * Snapshot of GraphQL state for per-tab caching. The schema is per tab too:
 * each tab introspects its own endpoint without overwriting its siblings.
 */
interface TabGraphQLState extends WithheldState {
  url: string
  query: string
  variables: string
  headers: KeyValuePair[]
  response: ApiResponse | null
  isLoading: boolean
  /** request:send IPC id for the in-flight GraphQL query — used by cancelQuery. */
  _inflightRequestId: string | null
  /** The `connection_init` payload, JSON as typed; '' = none. */
  connectionInit: string
  /** The Operation select's choice, as picked; '' = none. `chooseGraphqlOperation` reads it. */
  operationName: string
  subscriptionState: SubscriptionState
  /** Newest last, at most `GQL_MAX_SUBSCRIPTION_EVENTS`. */
  subscriptionEvents: GqlSubscriptionEvent[]
  /** Events dropped by the cap. */
  subscriptionDropped: number
  subscriptionError: string | null
  /** Why the last subscription ended, until the next Subscribe. */
  subscriptionEnd: SubscriptionEnd | null
  /** The running subscription; slice fields `lib/realtime-connections.ts` reads. */
  connectionId: string | null
  _pendingConnectId?: string
  _projectId?: string | null
  _unsubscribe?: () => void
  schemaData: GqlSchema | null
  isIntrospecting: boolean
  introspectError: string | null
}

interface GraphQLStore extends TabGraphQLState {
  /** Per-tab state cache */
  _tabStates: Map<string, TabGraphQLState>
  _currentTabId: string | null

  setUrl: (url: string) => void
  setQuery: (query: string) => void
  setVariables: (vars: string) => void
  setHeaders: (headers: KeyValuePair[]) => void
  setConnectionInit: (text: string) => void
  setOperationName: (name: string) => void
  addHeader: () => void
  updateHeader: (id: string, updates: Partial<KeyValuePair>) => void
  removeHeader: (id: string) => void

  executeQuery: () => Promise<void>
  cancelQuery: () => Promise<void>
  introspect: () => Promise<void>
  subscribe: () => Promise<void>
  unsubscribe: () => Promise<void>
  clearSubscriptionEvents: () => void

  /** Switch active tab — saves current state and loads target tab state. */
  /** Duplicate Tab: copy a tab's slice onto a new tab id, disconnected. */
  cloneTabState: (srcTabId: string, dstTabId: string) => void
  switchToTab: (tabId: string) => void
  /** Remove cached state for a closed tab. */
  removeTabState: (tabId: string) => void

  reset: () => void
}

const DEFAULT_QUERY = `# Write your GraphQL query here
# Example: { country(code: "TR") { name capital } }
query {

}
`

const INTROSPECTION_QUERY = `
query IntrospectionQuery {
  __schema {
    queryType { name }
    mutationType { name }
    subscriptionType { name }
    types {
      name
      kind
      description
      fields(includeDeprecated: true) {
        name
        type { name kind ofType { name kind ofType { name kind } } }
        args { name type { name kind ofType { name kind } } description }
        description
      }
      enumValues { name }
    }
  }
}
`

function resolveTypeName(typeObj: Record<string, unknown>): string {
  if (!typeObj) return 'Unknown'
  if (typeObj.name) return typeObj.name as string
  if (typeObj.ofType) return resolveTypeName(typeObj.ofType as Record<string, unknown>) + '!'
  return 'Unknown'
}

function parseIntrospectionResult(data: Record<string, unknown>): GqlSchema | null {
  const schema = data.__schema as Record<string, unknown> | undefined
  if (!schema) return null

  const queryType = (schema.queryType as Record<string, string> | null)?.name ?? null
  const mutationType = (schema.mutationType as Record<string, string> | null)?.name ?? null
  const subscriptionType = (schema.subscriptionType as Record<string, string> | null)?.name ?? null

  const rawTypes = (schema.types as Record<string, unknown>[]) || []
  const types: GqlType[] = rawTypes
    .filter((t) => !(t.name as string).startsWith('__'))
    .map((t) => ({
      name: t.name as string,
      kind: t.kind as GqlType['kind'],
      description: (t.description as string) || undefined,
      enumValues: (t.enumValues as Array<{ name: string }> | undefined)?.map((e) => e.name),
      fields: ((t.fields as Record<string, unknown>[] | null) || []).map((f) => ({
        name: f.name as string,
        type: resolveTypeName(f.type as Record<string, unknown>),
        description: (f.description as string) || undefined,
        args: ((f.args as Record<string, unknown>[] | null) || []).map((a) => ({
          name: a.name as string,
          type: resolveTypeName(a.type as Record<string, unknown>),
          description: (a.description as string) || undefined,
        })),
      })),
    }))

  return { queryType, mutationType, subscriptionType, types }
}

function emptyTabState(): TabGraphQLState {
  return {
    withheldCredentials: [],
    // Empty like Socket.IO / MCP (issue #257): no third-party host the user
    // did not type. The field shows an example placeholder instead.
    url: '',
    query: DEFAULT_QUERY,
    variables: '{}',
    headers: [defaultKv('Content-Type', 'application/json', true)],
    response: null,
    isLoading: false,
    _inflightRequestId: null,
    connectionInit: '',
    operationName: '',
    subscriptionState: 'disconnected',
    subscriptionEvents: [],
    subscriptionDropped: 0,
    subscriptionError: null,
    subscriptionEnd: null,
    connectionId: null,
    _pendingConnectId: undefined,
    _projectId: null,
    _unsubscribe: undefined,
    schemaData: null,
    isIntrospecting: false,
    introspectError: null,
  }
}

function extractState(s: GraphQLStore): TabGraphQLState {
  return {
    withheldCredentials: s.withheldCredentials,
    url: s.url,
    query: s.query,
    variables: s.variables,
    headers: s.headers,
    response: s.response,
    isLoading: s.isLoading,
    _inflightRequestId: s._inflightRequestId,
    connectionInit: s.connectionInit,
    operationName: s.operationName,
    subscriptionState: s.subscriptionState,
    subscriptionEvents: s.subscriptionEvents,
    subscriptionDropped: s.subscriptionDropped,
    subscriptionError: s.subscriptionError,
    subscriptionEnd: s.subscriptionEnd,
    connectionId: s.connectionId,
    _pendingConnectId: s._pendingConnectId,
    _projectId: s._projectId,
    _unsubscribe: s._unsubscribe,
    schemaData: s.schemaData,
    isIntrospecting: s.isIntrospecting,
    introspectError: s.introspectError,
  }
}

/**
 * On-disk view of a tab: URL, query, variables and headers — never the
 * response body or subscription events (server output; like the HTTP
 * response they stay in memory for the session). In-flight and subscription
 * state does not survive a reload either.
 */
/**
 * Issue #244: credential-named GraphQL headers rows never hold a literal value in
 * the snapshot (the row and its name stay; `{{var}}`-only values are kept).
 * The saved row keeps the value — `lib/withheld-credentials.ts` reloads it.
 * Issue #247: credential-named members of the `variables` JSON
 * (`"password": ""`) — blanked in the text, formatting kept. The same for the
 * `connection_init` payload, where browsers-first servers read their token.
 */
export const GQL_CREDENTIALS: CredentialSpec = {
  fields: [],
  rows: [credentialRows('headers')],
  texts: [
    jsonCredentialText('variables'),
    jsonCredentialText('connectionInit'),
    urlCredentialText('url'),
  ],
}

function persistableGql(st: TabGraphQLState): TabGraphQLState {
  return idleGql(withholdCredentials(st, GQL_CREDENTIALS))
}

/**
 * A tab with no request in flight, subscription or response — stored and copied
 * by Duplicate Tab. The schema is left out of the snapshot: an introspection
 * result can be megabytes and the next Introspect fetches it again.
 */
function idleGql(st: TabGraphQLState): TabGraphQLState {
  const idle = emptyTabState()
  return {
    ...st,
    response: idle.response,
    isLoading: idle.isLoading,
    _inflightRequestId: idle._inflightRequestId,
    subscriptionState: idle.subscriptionState,
    subscriptionEvents: idle.subscriptionEvents,
    subscriptionDropped: idle.subscriptionDropped,
    subscriptionError: idle.subscriptionError,
    subscriptionEnd: idle.subscriptionEnd,
    connectionId: idle.connectionId,
    _pendingConnectId: idle._pendingConnectId,
    _projectId: idle._projectId,
    _unsubscribe: idle._unsubscribe,
    schemaData: idle.schemaData,
    isIntrospecting: idle.isIntrospecting,
    introspectError: idle.introspectError,
  }
}

/**
 * The tab's saved fields: `metadata.graphql` on Ctrl+S and History's `configured`.
 * `connectionInit` and `operationName` only when set, so a row without one stays
 * byte-identical. A selection the document no longer holds is not written.
 */
export function gqlMetaOf(
  s: Pick<
    TabGraphQLState,
    'url' | 'query' | 'variables' | 'headers' | 'connectionInit' | 'operationName'
  >,
): Record<string, unknown> {
  const choice = chooseGraphqlOperation(s.query, s.operationName)
  const selected = s.operationName && !choice.staleSelection ? choice.operationName : undefined
  return {
    url: s.url,
    query: s.query,
    variables: s.variables,
    headers: s.headers,
    ...(s.connectionInit ? { connectionInit: s.connectionInit } : {}),
    ...(selected ? { operationName: selected } : {}),
  }
}

function getSubscriptionApi() {
  return window.api?.graphqlWs
}

/** Append, dropping the oldest past the cap. */
function withEvent(
  slice: TabGraphQLState,
  event: GqlSubscriptionEvent,
): Pick<TabGraphQLState, 'subscriptionEvents' | 'subscriptionDropped'> {
  const next = [...slice.subscriptionEvents, event]
  const over = next.length - GQL_MAX_SUBSCRIPTION_EVENTS
  return over > 0
    ? {
        subscriptionEvents: next.slice(over),
        subscriptionDropped: slice.subscriptionDropped + over,
      }
    : { subscriptionEvents: next, subscriptionDropped: slice.subscriptionDropped }
}

const STORAGE_KEY = 'testnizer-graphql'
const persisted = loadTabbedState<TabGraphQLState>(STORAGE_KEY, emptyTabState, persistableGql)

export const useGraphQLStore = create<GraphQLStore>((set, get) => ({
  ...persisted.current,
  _tabStates: persisted._tabStates,
  _currentTabId: persisted._currentTabId,

  setUrl: (url) => {
    set({ url })
    markActiveTabDirty()
  },
  setQuery: (query) => {
    set({ query })
    markActiveTabDirty()
  },
  setVariables: (vars) => {
    set({ variables: vars })
    markActiveTabDirty()
  },
  setHeaders: (headers) => {
    set({ headers })
    markActiveTabDirty()
  },
  setConnectionInit: (connectionInit) => {
    set({ connectionInit })
    markActiveTabDirty()
  },
  setOperationName: (operationName) => {
    set({ operationName })
    markActiveTabDirty()
  },

  addHeader: () => {
    set((state) => ({ headers: [...state.headers, defaultKv()] }))
    markActiveTabDirty()
  },

  updateHeader: (id, updates) => {
    set((state) => ({
      headers: state.headers.map((h) => (h.id === id ? { ...h, ...updates } : h)),
    }))
    markActiveTabDirty()
  },

  removeHeader: (id) => {
    set((state) => ({ headers: state.headers.filter((h) => h.id !== id) }))
    markActiveTabDirty()
  },

  executeQuery: async () => {
    // Issue #244: a credential still withheld after a restart is reloaded first.
    if (get().withheldCredentials.length > 0 && !(await reloadedOnSameTab(get))) return
    const { url, query, variables, headers, operationName } = get()
    if (!url.trim() || !query.trim()) return

    const responseStore = useResponseStore.getState()
    const tabsStore = useTabsStore.getState()
    const activeTabId = tabsStore.activeTabId

    // Issue #195: a History mask left in a credential field is never sent.
    const masked = graphqlMaskedSendError({
      url,
      variables,
      headers: headers.filter((h) => h.enabled),
    })
    if (masked) {
      const errResp: ApiResponse = {
        requestId: makeId(),
        protocol: 'graphql',
        error: masked,
        timing: { total: 0 },
      }
      set({ response: errResp })
      responseStore.setResponse(errResp, activeTabId)
      return
    }

    // Owner tab — async response routes back to this tab even if user
    // switches away while the request is in flight.
    const ownerTabId = get()._currentTabId

    set({ isLoading: true })
    responseStore.setLoading(true, activeTabId)
    responseStore.clearResponse(activeTabId)
    if (activeTabId) tabsStore.markLoading(activeTabId, true)

    const activeVars = useEnvironmentStore.getState().getActiveVariables()
    const resolvedUrl = resolveVariables(url, activeVars)
    const resolvedQuery = resolveVariables(query, activeVars)
    const resolvedVarsRaw = resolveVariables(variables || '', activeVars)
    const resolvedHeaders = resolveKeyValuePairs(
      headers.filter((h) => h.enabled && h.key.trim()),
      activeVars,
    )

    const requestId = makeId()
    set({ _inflightRequestId: requestId })

    const applyToOwner = (patch: Partial<TabGraphQLState>): void =>
      patchTabSlice<TabGraphQLState, GraphQLStore>(useGraphQLStore, ownerTabId, patch)

    try {
      const ws = useWorkspaceStore.getState()
      // SSL verification / redirects / TLS / proxy (issue #287): the shared
      // request → project → app chain Run applies to this row.
      const network = networkPayload(
        useRequestStore.getState(),
        await loadInheritedNetwork(ws.activeProjectId),
      )
      const result = await window.api?.request?.send({
        method: 'POST',
        url: resolvedUrl,
        headers: resolvedHeaders,
        body: {
          type: 'json',
          // Variables that do not parse go out empty (`graphqlJson`, Run's builder too).
          content: graphqlJson(
            resolvedQuery,
            resolvedVarsRaw,
            chooseGraphqlOperation(query, operationName).operationName,
          ),
        },
        ...network,
        _protocol: 'graphql',
        _requestId: requestId,
        _workspaceId: ws.activeWorkspaceId || undefined,
        _projectId: ws.activeProjectId || undefined,
        // Editor state with `{{var}}` kept — the History row reopens from it
        // (issues #182, #195). Same shape `snapshotProtocol` saves.
        _configured: { url, meta: { graphql: gqlMetaOf(get()) } },
      })

      if (result?.success && result.data) {
        const apiResp = result.data as ApiResponse
        applyToOwner({ response: apiResp })
        responseStore.setResponse(apiResp, activeTabId)
      } else {
        const errResp: ApiResponse = {
          requestId: makeId(),
          protocol: 'graphql',
          error: result?.error || 'GraphQL query failed',
          timing: { total: 0 },
        }
        applyToOwner({ response: errResp })
        responseStore.setResponse(errResp, activeTabId)
      }
    } catch (e) {
      const errResp: ApiResponse = {
        requestId: makeId(),
        protocol: 'graphql',
        error: (e as Error).message || 'GraphQL query failed',
        timing: { total: 0 },
      }
      applyToOwner({ response: errResp })
      responseStore.setResponse(errResp, activeTabId)
    } finally {
      const owner = readTabSlice<TabGraphQLState, GraphQLStore>(useGraphQLStore, ownerTabId)
      applyToOwner({
        isLoading: false,
        ...(owner?._inflightRequestId === requestId ? { _inflightRequestId: null } : {}),
      })
      responseStore.setLoading(false, activeTabId)
      if (activeTabId) tabsStore.markLoading(activeTabId, false)
    }
  },

  cancelQuery: async () => {
    const id = get()._inflightRequestId
    if (!id) return
    const ownerTabId = get()._currentTabId
    try {
      await window.api?.request?.cancel(id)
    } catch {
      // engine already finished
    }
    patchTabSlice<TabGraphQLState, GraphQLStore>(useGraphQLStore, ownerTabId, {
      _inflightRequestId: null,
      isLoading: false,
    })
  },

  introspect: async () => {
    // Issue #244: a credential still withheld after a restart is reloaded first.
    if (get().withheldCredentials.length > 0 && !(await reloadedOnSameTab(get))) return
    const { url, headers } = get()
    // The tab that asked gets the schema or the error, also when the user has
    // moved to another tab by the time it arrives.
    const ownerTabId = get()._currentTabId
    const patchOwner = (patch: Partial<TabGraphQLState>): void =>
      patchTabSlice<TabGraphQLState, GraphQLStore>(useGraphQLStore, ownerTabId, patch)
    if (!url.trim()) {
      // Previously silently returned — the user clicked Introspect and
      // nothing happened, no banner, no log (v1.4.4 §12.7). Surface a
      // clear error so the button feels live.
      set({ introspectError: 'Enter the GraphQL endpoint URL first.' })
      return
    }

    set({ isIntrospecting: true, introspectError: null })

    const introVars = useEnvironmentStore.getState().getActiveVariables()
    let introUrl = resolveVariables(url, introVars)
    // If `resolveVariables` left any `{{var}}` placeholders behind, the
    // variable was undefined in the active environment. Surface a clean
    // error instead of prepending `http://` and sending the literal
    // placeholder downstream — that path produces a misleading
    // "ENOTFOUND" / "Invalid URL" error far from the real cause
    // (v1.4.4 §12.7 sweep). Match the resolver's literal-fallback shape.
    const unresolved = introUrl.match(/\{\{\s*([^}\s]+)\s*\}\}/)
    if (unresolved) {
      set({
        introspectError: `Variable ${unresolved[0]} is not defined in the active environment.`,
        isIntrospecting: false,
      })
      return
    }
    // Default scheme when the user omits one. The HTTP engine requires a
    // full URL; without this `localhost:4000/graphql` would surface as
    // "Invalid URL" instead of actually trying introspection.
    if (introUrl && !/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(introUrl)) {
      introUrl = `http://${introUrl}`
    }
    const introHeaders = resolveKeyValuePairs(
      headers.filter((h) => h.enabled && h.key.trim()),
      introVars,
    )

    try {
      // Introspection talks to the same server as the query: same SSL / TLS /
      // proxy settings (issue #287).
      const network = networkPayload(
        useRequestStore.getState(),
        await loadInheritedNetwork(useWorkspaceStore.getState().activeProjectId),
      )
      const result = await window.api?.request?.send({
        method: 'POST',
        url: introUrl,
        ...network,
        headers: [
          ...introHeaders,
          // Default Content-Type so the gateway treats this as a valid
          // GraphQL POST. Don't override an explicit user header.
          ...(introHeaders.some((h) => h.key.toLowerCase() === 'content-type')
            ? []
            : [{ key: 'Content-Type', value: 'application/json', enabled: true }]),
        ],
        body: {
          type: 'json',
          content: JSON.stringify({ query: INTROSPECTION_QUERY }),
        },
      })

      if (result?.success && result.data) {
        const apiResp = result.data as ApiResponse
        if (apiResp.body) {
          let parsed: { data?: unknown; errors?: Array<{ message?: string }> }
          try {
            parsed = JSON.parse(apiResp.body)
          } catch {
            patchOwner({
              introspectError: `Server returned non-JSON response (status ${apiResp.status ?? '?'}).`,
              isIntrospecting: false,
            })
            return
          }
          // GraphQL surface-level errors come back with { errors: [...] }
          // even on HTTP 200.
          if (parsed.errors && parsed.errors.length > 0) {
            const msg = parsed.errors[0]?.message || 'GraphQL endpoint returned errors'
            patchOwner({ introspectError: msg, isIntrospecting: false })
            return
          }
          if (!parsed.data) {
            patchOwner({
              introspectError:
                'Server response had no `data` field — endpoint may not support introspection.',
              isIntrospecting: false,
            })
            return
          }
          const schema = parseIntrospectionResult(parsed.data as Record<string, unknown>)
          patchOwner({ schemaData: schema, isIntrospecting: false })
          return
        }
      }

      const errorMsg =
        (result as { error?: string } | undefined)?.error ?? 'Failed to introspect schema'
      patchOwner({ introspectError: errorMsg, isIntrospecting: false })
    } catch (e) {
      patchOwner({
        introspectError: (e as Error)?.message ?? 'Introspection failed',
        isIntrospecting: false,
      })
    }
  },

  subscribe: async () => {
    // Issue #244: a credential still withheld after a restart is reloaded first.
    if (get().withheldCredentials.length > 0 && !(await reloadedOnSameTab(get))) return
    const start = get()
    const chosen = chooseGraphqlOperation(start.query, start.operationName)
    if (!start.url.trim() || !chosen.isSubscription) return
    if (start.subscriptionState === 'connecting' || start.subscriptionState === 'connected') return

    const failNow = (text: string): void =>
      set({ subscriptionState: 'error', subscriptionError: text, subscriptionEnd: null })

    const headerRows = start.headers.filter((h) => h.enabled && h.key.trim())
    // Issue #195: a History mask left in a credential field is never sent.
    const masked = graphqlMaskedSendError({
      url: start.url,
      variables: start.variables,
      headers: headerRows,
      connectionInit: start.connectionInit,
    })
    if (masked) return failNow(masked)

    const vars = useEnvironmentStore.getState().getActiveVariables()
    const connectionInit = resolveVariables(start.connectionInit, vars)
    if (!parseConnectionInit(connectionInit).ok) return failNow(t('graphql.sub.invalidInit'))
    const api = getSubscriptionApi()
    if (!api) return failNow('GraphQL subscription bridge unavailable')

    const ownerTabId = start._currentTabId
    const owner = (): TabGraphQLState | undefined =>
      readTabSlice<TabGraphQLState, GraphQLStore>(useGraphQLStore, ownerTabId)
    const patchOwner = (patch: (slice: TabGraphQLState) => Partial<TabGraphQLState>): void =>
      updateTabSlice<TabGraphQLState, GraphQLStore>(useGraphQLStore, ownerTabId, patch)

    // The renderer's own id: a frame that overtakes the connect's reply is already this tab's.
    const connectionId = makeId()
    const workspace = useWorkspaceStore.getState()
    const { sslVerification, followRedirects } = useRequestStore.getState()
    start._unsubscribe?.()
    set({
      subscriptionState: 'connecting',
      subscriptionEvents: [],
      subscriptionDropped: 0,
      subscriptionError: null,
      subscriptionEnd: null,
      connectionId: null,
      _pendingConnectId: connectionId,
      _projectId: workspace.activeProjectId,
    })

    const unsub = api.onEvent((evt) => {
      if (evt.connectionId !== connectionId) return
      if (evt.type === 'data') {
        const row = {
          id: makeId(),
          kind: 'data' as const,
          data: evt.data,
          timestamp: evt.timestamp,
        }
        patchOwner((sl) => withEvent(sl, row))
      } else if (evt.type === 'error') {
        const row = {
          id: makeId(),
          kind: 'error' as const,
          data: evt.data ? `${evt.message}\n${evt.data}` : evt.message,
          timestamp: evt.timestamp,
        }
        patchOwner((sl) => withEvent(sl, row))
      } else {
        unsub()
        const end: SubscriptionEnd =
          evt.reason === 'close'
            ? { kind: 'closed', code: evt.code, reason: evt.closeReason }
            : { kind: evt.reason === 'complete' ? 'completed' : 'error' }
        patchOwner(() => ({
          subscriptionState: 'disconnected',
          subscriptionEnd: end,
          connectionId: null,
          _pendingConnectId: undefined,
          _unsubscribe: undefined,
        }))
      }
    })
    set({ _unsubscribe: unsub })

    const failOwner = (text: string): void => {
      unsub()
      patchOwner(() => ({
        subscriptionState: 'error',
        subscriptionError: text,
        connectionId: null,
        _pendingConnectId: undefined,
        _unsubscribe: undefined,
      }))
    }

    try {
      // SSL verification and TLS by the chain GraphQL Send uses (issue #287).
      const network = networkPayload(
        { sslVerification, followRedirects },
        await loadInheritedNetwork(workspace.activeProjectId),
      )
      // Given up while the settings loaded (Cancel, the tab closed, its project left).
      if (owner()?._pendingConnectId !== connectionId) return unsub()

      const headerMap: Record<string, string> = {}
      for (const row of resolveKeyValuePairs(headerRows, vars)) headerMap[row.key] = row.value
      const res = await api.connect({
        connectionId,
        url: resolveVariables(start.url, vars),
        headers: headerMap,
        query: resolveVariables(start.query, vars),
        variables: resolveVariables(start.variables || '', vars),
        ...(chosen.operationName ? { operationName: chosen.operationName } : {}),
        connectionInit,
        sslVerification: network.sslVerification,
        tls: network.tls,
        ...(network.proxy ? { proxy: network.proxy } : {}),
        _tabId: ownerTabId ?? undefined,
        _workspaceId: workspace.activeWorkspaceId || undefined,
        _projectId: workspace.activeProjectId || undefined,
        // Editor state with `{{var}}` kept: the History row reopens from it.
        _configured: { url: start.url, meta: { graphql: gqlMetaOf(start) } },
      })

      if (owner()?._pendingConnectId !== connectionId) {
        // It finished just as it was given up, or the server already ended it.
        if (res?.success) void api.disconnect(connectionId).catch(() => {})
        return
      }
      if (res?.success) {
        patchOwner(() => ({
          subscriptionState: 'connected',
          connectionId,
          _pendingConnectId: undefined,
        }))
      } else {
        failOwner(subscriptionFailureText(res, 'GraphQL subscription failed'))
      }
    } catch (e) {
      failOwner((e as Error).message)
    }
  },

  unsubscribe: async () => {
    const { connectionId, _pendingConnectId, _unsubscribe } = get()
    const api = getSubscriptionApi()
    if (!connectionId && !_pendingConnectId) return
    set({
      subscriptionState: 'disconnected',
      subscriptionEnd: { kind: 'unsubscribed' },
      connectionId: null,
      _pendingConnectId: undefined,
      _unsubscribe: undefined,
    })
    _unsubscribe?.()
    try {
      // The socket sends complete or stop, then closes.
      if (connectionId) await api?.disconnect(connectionId)
      else if (_pendingConnectId) await api?.cancelConnect(_pendingConnectId)
    } catch {
      // Already gone in main.
    }
  },

  clearSubscriptionEvents: () => set({ subscriptionEvents: [], subscriptionDropped: 0 }),

  cloneTabState: (srcTabId, dstTabId) =>
    // A duplicate points at the same endpoint: it keeps the schema already fetched.
    cloneTabSlice(useGraphQLStore, extractState, srcTabId, dstTabId, (st) => ({
      ...idleGql(st),
      schemaData: st.schemaData,
    })),

  switchToTab: (tabId) => {
    const state = get()
    const tabStates = new Map(state._tabStates)

    if (state._currentTabId) tabStates.set(state._currentTabId, extractState(state))

    const target = tabStates.get(tabId) || emptyTabState()

    set({
      ...target,
      _tabStates: tabStates,
      _currentTabId: tabId,
    })
  },

  removeTabState: (tabId) => {
    const state = get()
    const live = state._currentTabId === tabId
    // Closing the tab closes its subscription.
    releaseConnection(
      live ? extractState(state) : state._tabStates.get(tabId),
      getSubscriptionApi(),
    )
    const gone = withoutTab<TabGraphQLState>(state, tabId)
    set(
      live
        ? {
            ...gone,
            subscriptionState: 'disconnected',
            connectionId: null,
            _pendingConnectId: undefined,
            _unsubscribe: undefined,
          }
        : gone,
    )
  },

  reset: () => {
    releaseConnection(extractState(get()), getSubscriptionApi())
    set({ ...emptyTabState() })
  },
}))

attachTabbedPersist(
  useGraphQLStore,
  STORAGE_KEY,
  extractState,
  (s) => ({ _tabStates: s._tabStates, _currentTabId: s._currentTabId }),
  persistableGql,
)
// Issue #244: a user edit to a withheld value drops its marker.
trackCredentialEdits(useGraphQLStore, GQL_CREDENTIALS)
// Leaving a project closes the subscriptions opened in it (one rule for the
// realtime editors, `lib/realtime-connections.ts`).
bindConnectionsToProject({
  store: useGraphQLStore,
  extract: extractState,
  api: getSubscriptionApi,
  closed: (sl, wasConnected) => ({
    ...sl,
    subscriptionState: 'disconnected' as const,
    subscriptionEnd: wasConnected ? { kind: 'projectLeft' as const } : sl.subscriptionEnd,
  }),
})
