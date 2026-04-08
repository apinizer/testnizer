import { create } from 'zustand'
import type { KeyValuePair, ApiResponse, SseEvent } from '../types'
import { useResponseStore } from './response.store'
import { useTabsStore } from './tabs.store'

function makeId(): string {
  return Math.random().toString(36).substring(2, 10)
}

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

interface GraphQLStore {
  url: string
  query: string
  variables: string
  headers: KeyValuePair[]
  response: ApiResponse | null
  isLoading: boolean

  schemaData: GqlSchema | null
  isIntrospecting: boolean
  introspectError: string | null

  subscriptionState: SubscriptionState
  subscriptionEvents: GqlSubscriptionEvent[]

  setUrl: (url: string) => void
  setQuery: (query: string) => void
  setVariables: (vars: string) => void
  addHeader: () => void
  updateHeader: (id: string, updates: Partial<KeyValuePair>) => void
  removeHeader: (id: string) => void

  executeQuery: () => Promise<void>
  introspect: () => Promise<void>
  subscribe: () => Promise<void>
  unsubscribe: () => Promise<void>
  clearSubscriptionEvents: () => void

  reset: () => void
}

const DEFAULT_QUERY = `# Write your GraphQL query here
query {
  hello
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

export const useGraphQLStore = create<GraphQLStore>((set, get) => ({
  url: 'https://countries.trevorblades.com/graphql',
  query: DEFAULT_QUERY,
  variables: '{}',
  headers: [defaultKv('Content-Type', 'application/json', true)],
  response: null,
  isLoading: false,

  schemaData: null,
  isIntrospecting: false,
  introspectError: null,

  subscriptionState: 'disconnected',
  subscriptionEvents: [],

  setUrl: (url) => set({ url }),
  setQuery: (query) => set({ query }),
  setVariables: (vars) => set({ variables: vars }),

  addHeader: () =>
    set((state) => ({ headers: [...state.headers, defaultKv()] })),

  updateHeader: (id, updates) =>
    set((state) => ({
      headers: state.headers.map((h) => (h.id === id ? { ...h, ...updates } : h)),
    })),

  removeHeader: (id) =>
    set((state) => ({ headers: state.headers.filter((h) => h.id !== id) })),

  executeQuery: async () => {
    const { url, query, variables, headers } = get()
    if (!url.trim() || !query.trim()) return

    const responseStore = useResponseStore.getState()
    const tabsStore = useTabsStore.getState()
    const activeTabId = tabsStore.activeTabId

    set({ isLoading: true })
    responseStore.setLoading(true)
    responseStore.clearResponse()
    if (activeTabId) tabsStore.markLoading(activeTabId, true)

    let parsedVars: Record<string, unknown> = {}
    try {
      parsedVars = JSON.parse(variables || '{}')
    } catch {
      // ignore parse errors, send empty
    }

    try {
      const result = await window.api?.request?.send({
        method: 'POST',
        url,
        headers: headers.filter((h) => h.enabled && h.key.trim()),
        body: {
          type: 'json',
          content: JSON.stringify({ query, variables: parsedVars }),
        },
      })

      if (result?.success && result.data) {
        const apiResp = result.data as ApiResponse
        set({ response: apiResp })
        responseStore.setResponse(apiResp)
      } else {
        const errResp: ApiResponse = {
          requestId: makeId(),
          protocol: 'graphql',
          error: result?.error || 'GraphQL query failed',
          timing: { total: 0 },
        }
        set({ response: errResp })
        responseStore.setResponse(errResp)
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
          2
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
      set({ response: demoResp })
      responseStore.setResponse(demoResp)
    } finally {
      set({ isLoading: false })
      responseStore.setLoading(false)
      if (activeTabId) tabsStore.markLoading(activeTabId, false)
    }
  },

  introspect: async () => {
    const { url, headers } = get()
    if (!url.trim()) return

    set({ isIntrospecting: true, introspectError: null })

    try {
      const result = await window.api?.request?.send({
        method: 'POST',
        url,
        headers: headers.filter((h) => h.enabled && h.key.trim()),
        body: {
          type: 'json',
          content: JSON.stringify({ query: INTROSPECTION_QUERY }),
        },
      })

      if (result?.success && result.data) {
        const apiResp = result.data as ApiResponse
        if (apiResp.body) {
          const parsed = JSON.parse(apiResp.body)
          const schema = parseIntrospectionResult(parsed.data || parsed)
          set({ schemaData: schema, isIntrospecting: false })
          return
        }
      }

      set({ introspectError: 'Failed to introspect schema', isIntrospecting: false })
    } catch {
      // Demo mode: generate a sample schema
      const demoSchema: GqlSchema = {
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
              { name: 'onMessage', type: 'Message', args: [], description: 'Listen for new messages' },
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
      set({ schemaData: demoSchema, isIntrospecting: false })
    }
  },

  subscribe: async () => {
    const { url, query } = get()
    if (!url.trim() || !isSubscriptionQuery(query)) return

    set({ subscriptionState: 'connecting', subscriptionEvents: [] })

    try {
      const result = await window.api?.request?.send({
        method: 'GQL_SUBSCRIBE',
        url,
        body: { type: 'json', content: JSON.stringify({ query }) },
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
              data: JSON.stringify({ data: { onMessage: { id: makeId(), text: `Event at ${new Date().toISOString()}` } } }, null, 2),
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

  reset: () =>
    set({
      url: 'https://countries.trevorblades.com/graphql',
      query: DEFAULT_QUERY,
      variables: '{}',
      headers: [defaultKv('Content-Type', 'application/json', true)],
      response: null,
      isLoading: false,
      schemaData: null,
      isIntrospecting: false,
      introspectError: null,
      subscriptionState: 'disconnected',
      subscriptionEvents: [],
    }),
}))
