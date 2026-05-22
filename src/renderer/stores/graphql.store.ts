import { create } from 'zustand'
import type { KeyValuePair, ApiResponse } from '../types'
import { useResponseStore } from './response.store'
import { useTabsStore } from './tabs.store'
import { useEnvironmentStore } from './environment.store'
import { useWorkspaceStore } from './workspace.store'
import { resolveVariables, resolveKeyValuePairs } from '../lib/variable-resolver'
import { loadTabbedState, attachTabbedPersist } from '../lib/persist-helpers'
import { makeId } from '../lib/utils'

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
  data: string
  timestamp: number
}

// ─── Store ───────────────────────────────────────────────────

type SubscriptionState = 'disconnected' | 'connecting' | 'connected' | 'error'

/**
 * Snapshot of GraphQL state for per-tab caching. `schemaData` /
 * `isIntrospecting` / `introspectError` are intentionally NOT in this set —
 * the schema is keyed off the endpoint URL and lives in a separate global cache.
 */
interface TabGraphQLState {
  url: string
  query: string
  variables: string
  headers: KeyValuePair[]
  response: ApiResponse | null
  isLoading: boolean
  /** request:send IPC id for the in-flight GraphQL query — used by cancelQuery. */
  _inflightRequestId: string | null
  subscriptionState: SubscriptionState
  subscriptionEvents: GqlSubscriptionEvent[]
}

interface GraphQLStore extends TabGraphQLState {
  // Global schema state (shared across tabs — schema is keyed by URL externally).
  schemaData: GqlSchema | null
  isIntrospecting: boolean
  introspectError: string | null

  /** Per-tab state cache */
  _tabStates: Map<string, TabGraphQLState>
  _currentTabId: string | null

  setUrl: (url: string) => void
  setQuery: (query: string) => void
  setVariables: (vars: string) => void
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
  switchToTab: (tabId: string) => void
  /** Remove cached state for a closed tab. */
  removeTabState: (tabId: string) => void

  reset: () => void
}

const DEFAULT_QUERY = `# Write your GraphQL query here
# Example (countries API): { country(code: "TR") { name capital } }
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

function isSubscriptionQuery(query: string): boolean {
  const trimmed = query.replace(/#.*$/gm, '').trim()
  return trimmed.startsWith('subscription')
}

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
    url: 'https://countries.trevorblades.com/graphql',
    query: DEFAULT_QUERY,
    variables: '{}',
    headers: [defaultKv('Content-Type', 'application/json', true)],
    response: null,
    isLoading: false,
    _inflightRequestId: null,
    subscriptionState: 'disconnected',
    subscriptionEvents: [],
  }
}

function extractState(s: GraphQLStore): TabGraphQLState {
  return {
    url: s.url,
    query: s.query,
    variables: s.variables,
    headers: s.headers,
    response: s.response,
    isLoading: s.isLoading,
    _inflightRequestId: s._inflightRequestId,
    subscriptionState: s.subscriptionState,
    subscriptionEvents: s.subscriptionEvents,
  }
}

const STORAGE_KEY = 'testnizer-graphql'
const persisted = loadTabbedState<TabGraphQLState>(STORAGE_KEY, emptyTabState)

export const useGraphQLStore = create<GraphQLStore>((set, get) => ({
  ...persisted.current,
  _tabStates: persisted._tabStates,
  _currentTabId: persisted._currentTabId,

  schemaData: null,
  isIntrospecting: false,
  introspectError: null,

  setUrl: (url) => set({ url }),
  setQuery: (query) => set({ query }),
  setVariables: (vars) => set({ variables: vars }),

  addHeader: () => set((state) => ({ headers: [...state.headers, defaultKv()] })),

  updateHeader: (id, updates) =>
    set((state) => ({
      headers: state.headers.map((h) => (h.id === id ? { ...h, ...updates } : h)),
    })),

  removeHeader: (id) => set((state) => ({ headers: state.headers.filter((h) => h.id !== id) })),

  executeQuery: async () => {
    const { url, query, variables, headers } = get()
    if (!url.trim() || !query.trim()) return

    const responseStore = useResponseStore.getState()
    const tabsStore = useTabsStore.getState()
    const activeTabId = tabsStore.activeTabId

    // Owner tab — async response routes back to this tab even if user
    // switches away while the request is in flight.
    const ownerTabId = get()._currentTabId

    set({ isLoading: true })
    responseStore.setLoading(true)
    responseStore.clearResponse()
    if (activeTabId) tabsStore.markLoading(activeTabId, true)

    const activeVars = useEnvironmentStore.getState().getActiveVariables()
    const resolvedUrl = resolveVariables(url, activeVars)
    const resolvedQuery = resolveVariables(query, activeVars)
    const resolvedVarsRaw = resolveVariables(variables || '', activeVars)
    const resolvedHeaders = resolveKeyValuePairs(
      headers.filter((h) => h.enabled && h.key.trim()),
      activeVars,
    )

    let parsedVars: Record<string, unknown> = {}
    try {
      parsedVars = JSON.parse(resolvedVarsRaw || '{}')
    } catch {
      // ignore parse errors, send empty
    }

    const requestId = makeId()
    set({ _inflightRequestId: requestId })

    const applyToOwner = (patch: Partial<TabGraphQLState>): void => {
      const current = get()
      if (current._currentTabId === ownerTabId) {
        set(patch as Partial<GraphQLStore>)
      } else if (ownerTabId !== null) {
        const map = new Map(current._tabStates)
        const existing = map.get(ownerTabId) ?? emptyTabState()
        map.set(ownerTabId, { ...existing, ...patch })
        set({ _tabStates: map })
      }
    }

    try {
      const ws = useWorkspaceStore.getState()
      const result = await window.api?.request?.send({
        method: 'POST',
        url: resolvedUrl,
        headers: resolvedHeaders,
        body: {
          type: 'json',
          content: JSON.stringify({ query: resolvedQuery, variables: parsedVars }),
        },
        _protocol: 'graphql',
        _requestId: requestId,
        _workspaceId: ws.activeWorkspaceId || undefined,
        _projectId: ws.activeProjectId || undefined,
      })

      if (result?.success && result.data) {
        const apiResp = result.data as ApiResponse
        applyToOwner({ response: apiResp })
        if (get()._currentTabId === ownerTabId) {
          responseStore.setResponse(apiResp)
        }
      } else {
        const errResp: ApiResponse = {
          requestId: makeId(),
          protocol: 'graphql',
          error: result?.error || 'GraphQL query failed',
          timing: { total: 0 },
        }
        applyToOwner({ response: errResp })
        if (get()._currentTabId === ownerTabId) {
          responseStore.setResponse(errResp)
        }
      }
    } catch {
      // Demo mode
      const demoResp: ApiResponse = {
        requestId: makeId(),
        protocol: 'graphql',
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          {
            data: {
              hello: 'Hello from GraphQL demo!',
            },
          },
          null,
          2,
        ),
        bodySize: 52,
        timing: { total: 89 },
        actualRequest: {
          method: 'POST',
          url,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query, variables: parsedVars }),
        },
      }
      applyToOwner({ response: demoResp })
      if (get()._currentTabId === ownerTabId) {
        responseStore.setResponse(demoResp)
      }
    } finally {
      const current = get()
      const ownerIsLive = current._currentTabId === ownerTabId
      if (ownerIsLive) {
        set((s) => ({
          isLoading: false,
          _inflightRequestId: s._inflightRequestId === requestId ? null : s._inflightRequestId,
        }))
      } else if (ownerTabId !== null) {
        const map = new Map(current._tabStates)
        const existing = map.get(ownerTabId) ?? emptyTabState()
        map.set(ownerTabId, {
          ...existing,
          isLoading: false,
          _inflightRequestId:
            existing._inflightRequestId === requestId ? null : existing._inflightRequestId,
        })
        set({ _tabStates: map })
      }
      responseStore.setLoading(false)
      if (activeTabId) tabsStore.markLoading(activeTabId, false)
    }
  },

  cancelQuery: async () => {
    const id = get()._inflightRequestId
    if (!id) return
    try {
      await window.api?.request?.cancel(id)
    } catch {
      // engine already finished
    }
    set({ _inflightRequestId: null, isLoading: false })
  },

  introspect: async () => {
    const { url, headers } = get()
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
      const result = await window.api?.request?.send({
        method: 'POST',
        url: introUrl,
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
            set({
              introspectError: `Server returned non-JSON response (status ${apiResp.status ?? '?'}).`,
              isIntrospecting: false,
            })
            return
          }
          // GraphQL surface-level errors come back with { errors: [...] }
          // even on HTTP 200. Bubble the first message instead of
          // dropping to a misleading demo schema.
          if (parsed.errors && parsed.errors.length > 0) {
            const msg = parsed.errors[0]?.message || 'GraphQL endpoint returned errors'
            set({ introspectError: msg, isIntrospecting: false })
            return
          }
          if (!parsed.data) {
            set({
              introspectError:
                'Server response had no `data` field — endpoint may not support introspection.',
              isIntrospecting: false,
            })
            return
          }
          const schema = parseIntrospectionResult(parsed.data as Record<string, unknown>)
          set({ schemaData: schema, isIntrospecting: false })
          return
        }
      }

      const errorMsg =
        (result as { error?: string } | undefined)?.error ?? 'Failed to introspect schema'
      set({ introspectError: errorMsg, isIntrospecting: false })
    } catch (e) {
      // Real introspection failures used to fall through to a fake demo
      // schema, which made the button look broken (v1.4.2 T-12.11 —
      // user clicked Introspect, "saw" a Query/User/Post tree appear,
      // then could not figure out why their actual schema's queries
      // didn't run). Surface the error instead.
      set({
        introspectError: (e as Error)?.message ?? 'Introspection failed',
        isIntrospecting: false,
      })
      // Demo schema kept below so existing test fixtures still parse,
      // but is now unreachable in normal product paths.
      const _demoSchema: GqlSchema = {
        queryType: 'Query',
        mutationType: 'Mutation',
        subscriptionType: 'Subscription',
        types: [
          {
            name: 'Query',
            kind: 'OBJECT',
            description: 'Root query type',
            fields: [
              { name: 'hello', type: 'String', args: [], description: 'A simple hello query' },
              {
                name: 'user',
                type: 'User',
                args: [{ name: 'id', type: 'ID!', description: 'User ID' }],
                description: 'Get user by ID',
              },
              { name: 'users', type: '[User]', args: [], description: 'List all users' },
              {
                name: 'posts',
                type: '[Post]',
                args: [
                  { name: 'limit', type: 'Int' },
                  { name: 'offset', type: 'Int' },
                ],
                description: 'List posts with pagination',
              },
            ],
          },
          {
            name: 'Mutation',
            kind: 'OBJECT',
            description: 'Root mutation type',
            fields: [
              {
                name: 'createUser',
                type: 'User',
                args: [
                  { name: 'name', type: 'String!' },
                  { name: 'email', type: 'String!' },
                ],
                description: 'Create a new user',
              },
              {
                name: 'deleteUser',
                type: 'Boolean',
                args: [{ name: 'id', type: 'ID!' }],
                description: 'Delete a user',
              },
            ],
          },
          {
            name: 'Subscription',
            kind: 'OBJECT',
            description: 'Root subscription type',
            fields: [
              {
                name: 'onMessage',
                type: 'Message',
                args: [],
                description: 'Listen for new messages',
              },
            ],
          },
          {
            name: 'User',
            kind: 'OBJECT',
            description: 'A user in the system',
            fields: [
              { name: 'id', type: 'ID!', args: [] },
              { name: 'name', type: 'String!', args: [] },
              { name: 'email', type: 'String!', args: [] },
              { name: 'posts', type: '[Post]', args: [] },
            ],
          },
          {
            name: 'Post',
            kind: 'OBJECT',
            description: 'A blog post',
            fields: [
              { name: 'id', type: 'ID!', args: [] },
              { name: 'title', type: 'String!', args: [] },
              { name: 'content', type: 'String', args: [] },
              { name: 'author', type: 'User', args: [] },
            ],
          },
          {
            name: 'Message',
            kind: 'OBJECT',
            fields: [
              { name: 'id', type: 'ID!', args: [] },
              { name: 'text', type: 'String!', args: [] },
              { name: 'sender', type: 'User', args: [] },
            ],
          },
          {
            name: 'Role',
            kind: 'ENUM',
            fields: [],
            enumValues: ['ADMIN', 'USER', 'MODERATOR'],
          },
        ],
      }
      void _demoSchema
    }
  },

  subscribe: async () => {
    const { url, query } = get()
    if (!url.trim() || !isSubscriptionQuery(query)) return

    set({ subscriptionState: 'connecting', subscriptionEvents: [] })

    const subVars = useEnvironmentStore.getState().getActiveVariables()
    const subUrl = resolveVariables(url, subVars)
    const subQuery = resolveVariables(query, subVars)

    try {
      const result = await window.api?.request?.send({
        method: 'GQL_SUBSCRIBE',
        url: subUrl,
        body: { type: 'json', content: JSON.stringify({ query: subQuery }) },
      })

      if (result?.success) {
        set({ subscriptionState: 'connected' })
      } else {
        set({ subscriptionState: 'error' })
      }
    } catch {
      // Demo mode: simulate subscription
      set({ subscriptionState: 'connected' })

      const interval = setInterval(() => {
        const state = get()
        if (state.subscriptionState !== 'connected') {
          clearInterval(interval)
          return
        }
        set((s) => ({
          subscriptionEvents: [
            ...s.subscriptionEvents,
            {
              id: makeId(),
              data: JSON.stringify(
                {
                  data: {
                    onMessage: { id: makeId(), text: `Event at ${new Date().toISOString()}` },
                  },
                },
                null,
                2,
              ),
              timestamp: Date.now(),
            },
          ],
        }))
      }, 3000)

      // Store cleanup reference
      const unsubscribeCheck = setInterval(() => {
        if (get().subscriptionState !== 'connected') {
          clearInterval(interval)
          clearInterval(unsubscribeCheck)
        }
      }, 500)
    }
  },

  unsubscribe: async () => {
    set({ subscriptionState: 'disconnected' })

    try {
      await window.api?.request?.cancel('gql-subscription')
    } catch {
      // Ignore
    }
  },

  clearSubscriptionEvents: () => set({ subscriptionEvents: [] }),

  switchToTab: (tabId) => {
    const state = get()
    const tabStates = new Map(state._tabStates)

    const currentKey = state._currentTabId === null ? '__null__' : state._currentTabId
    tabStates.set(currentKey, extractState(state))

    const target = tabStates.get(tabId) || emptyTabState()

    set({
      ...target,
      _tabStates: tabStates,
      _currentTabId: tabId,
    })
  },

  removeTabState: (tabId) => {
    const tabStates = new Map(get()._tabStates)
    tabStates.delete(tabId)
    set({ _tabStates: tabStates })
  },

  reset: () =>
    set({
      ...emptyTabState(),
      schemaData: null,
      isIntrospecting: false,
      introspectError: null,
    }),
}))

attachTabbedPersist(useGraphQLStore, STORAGE_KEY, extractState, (s) => ({
  _tabStates: s._tabStates,
  _currentTabId: s._currentTabId,
}))
