import axios, { AxiosRequestConfig } from 'axios'
import { randomUUID } from 'crypto'
import { performance } from 'perf_hooks'
import https from 'https'
import http from 'http'
import { createClient, Client } from 'graphql-ws'
import WebSocket from 'ws'
import { BrowserWindow } from 'electron'
import { classifyTransportError } from '../lib/error-classifier'

// ─── Types ───────────────────────────────────────────────────

interface KeyValuePair {
  id: string
  key: string
  value: string
  description?: string
  enabled: boolean
}

interface AuthConfig {
  type: string
  basic?: { username: string; password: string }
  bearer?: { token: string; prefix?: string }
  apiKey?: { key: string; value: string; in: 'header' | 'query' }
  oauth2?: { token?: string }
}

interface ResponseTiming {
  total: number
  dns?: number
  tcp?: number
  tls?: number
  ttfb?: number
  download?: number
}

interface GraphqlApiResponse {
  requestId: string
  protocol: 'graphql'
  status?: number
  statusText?: string
  headers?: Record<string, string>
  body?: string
  bodySize?: number
  timing: ResponseTiming
  error?: string
  actualRequest?: {
    method: string
    url: string
    headers: Record<string, string>
    body?: string
  }
}

export interface GraphqlExecuteOptions {
  url: string
  query: string
  variables?: string
  operationName?: string
  headers?: KeyValuePair[]
  auth?: AuthConfig
  timeout?: number
  sslVerification?: boolean
}

export interface GraphqlIntrospectionResult {
  types: GraphqlTypeInfo[]
  queryType: string | null
  mutationType: string | null
  subscriptionType: string | null
}

export interface GraphqlTypeInfo {
  name: string
  kind: string
  fields: GraphqlFieldInfo[] | null
}

export interface GraphqlFieldInfo {
  name: string
  type: {
    name: string | null
    kind: string
    ofType: {
      name: string | null
      kind: string
    } | null
  }
}

export interface GraphqlSubscribeOptions {
  url: string
  wsUrl?: string
  query: string
  variables?: string
  operationName?: string
  headers?: Record<string, string>
  sslVerification?: boolean
}

export interface GraphqlSubscriptionEvent {
  subscriptionId: string
  type: 'data' | 'error' | 'complete'
  data?: string
  error?: string
  timestamp: number
}

// ─── Subscription manager ───────────────────────────────────

interface ManagedSubscription {
  subscriptionId: string
  client: Client
  unsubscribe: () => void
  windowId: number
}

const subscriptions = new Map<string, ManagedSubscription>()

function sendSubscriptionEvent(windowId: number, event: GraphqlSubscriptionEvent): void {
  const win = BrowserWindow.fromId(windowId)
  if (win && !win.isDestroyed()) {
    win.webContents.send('graphql:subscriptionEvent', event)
  }
}

// ─── Helper: build headers from auth + kvp ──────────────────

function buildHeaders(headers?: KeyValuePair[], auth?: AuthConfig): Record<string, string> {
  const result: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  if (headers) {
    for (const h of headers) {
      if (h.enabled && h.key) {
        result[h.key] = h.value
      }
    }
  }

  if (auth && auth.type !== 'none') {
    switch (auth.type) {
      case 'basic': {
        if (auth.basic) {
          const encoded = Buffer.from(`${auth.basic.username}:${auth.basic.password}`).toString(
            'base64',
          )
          result['Authorization'] = `Basic ${encoded}`
        }
        break
      }
      case 'bearer': {
        if (auth.bearer) {
          const prefix = auth.bearer.prefix || 'Bearer'
          result['Authorization'] = `${prefix} ${auth.bearer.token}`
        }
        break
      }
      case 'api-key': {
        if (auth.apiKey && auth.apiKey.in === 'header') {
          result[auth.apiKey.key] = auth.apiKey.value
        }
        break
      }
      case 'oauth2': {
        if (auth.oauth2?.token) {
          result['Authorization'] = `Bearer ${auth.oauth2.token}`
        }
        break
      }
    }
  }

  return result
}

// ─── Public API ─────────────────────────────────────────────

export async function executeQuery(options: GraphqlExecuteOptions): Promise<GraphqlApiResponse> {
  const requestId = randomUUID()
  const startTime = performance.now()

  try {
    const headers = buildHeaders(options.headers, options.auth)

    let variables: Record<string, unknown> | undefined
    if (options.variables) {
      try {
        variables = JSON.parse(options.variables) as Record<string, unknown>
      } catch {
        return {
          requestId,
          protocol: 'graphql',
          timing: { total: Math.round(performance.now() - startTime) },
          error: 'Invalid JSON in variables field',
        }
      }
    }

    const requestBody: Record<string, unknown> = {
      query: options.query,
    }
    if (variables) {
      requestBody.variables = variables
    }
    if (options.operationName) {
      requestBody.operationName = options.operationName
    }

    const bodyStr = JSON.stringify(requestBody)

    // Add api-key query param if needed
    let url = options.url
    if (options.auth?.type === 'api-key' && options.auth.apiKey?.in === 'query') {
      const sep = url.includes('?') ? '&' : '?'
      url = `${url}${sep}${encodeURIComponent(options.auth.apiKey.key)}=${encodeURIComponent(options.auth.apiKey.value)}`
    }

    const config: AxiosRequestConfig = {
      method: 'POST',
      url,
      headers,
      data: bodyStr,
      timeout: options.timeout ?? 30000,
      validateStatus: () => true,
      responseType: 'text',
      transformResponse: [(d: string) => d],
      httpsAgent: new https.Agent({
        rejectUnauthorized: options.sslVerification !== false,
      }),
      httpAgent: new http.Agent(),
    }

    const response = await axios.request(config)
    const endTime = performance.now()

    const responseHeaders: Record<string, string> = {}
    for (const [key, value] of Object.entries(response.headers)) {
      if (value !== undefined) {
        responseHeaders[key] = Array.isArray(value) ? value.join(', ') : String(value)
      }
    }

    const responseBody =
      typeof response.data === 'string' ? response.data : JSON.stringify(response.data)
    const bodySize = Buffer.byteLength(responseBody, 'utf-8')

    return {
      requestId,
      protocol: 'graphql',
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      body: responseBody,
      bodySize,
      timing: { total: Math.round(endTime - startTime) },
      actualRequest: {
        method: 'POST',
        url: options.url,
        headers,
        body: bodyStr,
      },
    }
  } catch (err) {
    const endTime = performance.now()
    const classified = classifyTransportError(err)
    return {
      requestId,
      protocol: 'graphql',
      timing: { total: Math.round(endTime - startTime) },
      error: classified.message,
    }
  }
}

export async function introspect(
  url: string,
  headers?: Record<string, string>,
  sslVerification?: boolean,
): Promise<GraphqlIntrospectionResult> {
  const introspectionQuery = `{
  __schema {
    types {
      name
      kind
      fields {
        name
        type {
          name
          kind
          ofType {
            name
            kind
          }
        }
      }
    }
    queryType { name }
    mutationType { name }
    subscriptionType { name }
  }
}`

  const requestHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...headers,
  }

  const config: AxiosRequestConfig = {
    method: 'POST',
    url,
    headers: requestHeaders,
    data: JSON.stringify({ query: introspectionQuery }),
    timeout: 30000,
    validateStatus: () => true,
    httpsAgent: new https.Agent({
      rejectUnauthorized: sslVerification !== false,
    }),
    httpAgent: new http.Agent(),
  }

  const response = await axios.request(config)
  const body =
    typeof response.data === 'string'
      ? (JSON.parse(response.data) as Record<string, unknown>)
      : (response.data as Record<string, unknown>)

  const data = body.data as
    | {
        __schema: {
          types: Array<{
            name: string
            kind: string
            fields: Array<{
              name: string
              type: {
                name: string | null
                kind: string
                ofType: { name: string | null; kind: string } | null
              }
            }> | null
          }>
          queryType: { name: string } | null
          mutationType: { name: string } | null
          subscriptionType: { name: string } | null
        }
      }
    | undefined

  if (!data?.__schema) {
    const errors = body.errors as Array<{ message: string }> | undefined
    const errorMsg = errors?.[0]?.message ?? 'Introspection failed: no schema returned'
    throw new Error(errorMsg)
  }

  const schema = data.__schema

  const types: GraphqlTypeInfo[] = schema.types.map((t) => ({
    name: t.name,
    kind: t.kind,
    fields: t.fields
      ? t.fields.map((f) => ({
          name: f.name,
          type: {
            name: f.type.name,
            kind: f.type.kind,
            ofType: f.type.ofType ? { name: f.type.ofType.name, kind: f.type.ofType.kind } : null,
          },
        }))
      : null,
  }))

  return {
    types,
    queryType: schema.queryType?.name ?? null,
    mutationType: schema.mutationType?.name ?? null,
    subscriptionType: schema.subscriptionType?.name ?? null,
  }
}

export function subscribe(options: GraphqlSubscribeOptions, windowId: number): string {
  const subscriptionId = randomUUID()

  // Determine WS URL: replace http(s) with ws(s)
  const wsUrl = options.wsUrl ?? options.url.replace(/^http/, 'ws')

  let variables: Record<string, unknown> | undefined
  if (options.variables) {
    try {
      variables = JSON.parse(options.variables) as Record<string, unknown>
    } catch {
      sendSubscriptionEvent(windowId, {
        subscriptionId,
        type: 'error',
        error: 'Invalid JSON in variables field',
        timestamp: Date.now(),
      })
      return subscriptionId
    }
  }

  const client = createClient({
    url: wsUrl,
    webSocketImpl: WebSocket,
    connectionParams: options.headers ?? {},
    on: {
      error: (err) => {
        const errorMsg =
          err instanceof Error
            ? err.message
            : ((err as CloseEvent)?.reason ?? 'Unknown subscription error')
        sendSubscriptionEvent(windowId, {
          subscriptionId,
          type: 'error',
          error: errorMsg,
          timestamp: Date.now(),
        })
      },
    },
  })

  const payload: { query: string; variables?: Record<string, unknown>; operationName?: string } = {
    query: options.query,
  }
  if (variables) {
    payload.variables = variables
  }
  if (options.operationName) {
    payload.operationName = options.operationName
  }

  const unsubscribe = client.subscribe(payload, {
    next: (value) => {
      sendSubscriptionEvent(windowId, {
        subscriptionId,
        type: 'data',
        data: JSON.stringify(value),
        timestamp: Date.now(),
      })
    },
    error: (err) => {
      const errorMsg =
        err instanceof Error
          ? err.message
          : Array.isArray(err)
            ? err.map((e) => (e as Error).message).join(', ')
            : 'Subscription error'
      sendSubscriptionEvent(windowId, {
        subscriptionId,
        type: 'error',
        error: errorMsg,
        timestamp: Date.now(),
      })
      subscriptions.delete(subscriptionId)
    },
    complete: () => {
      sendSubscriptionEvent(windowId, {
        subscriptionId,
        type: 'complete',
        timestamp: Date.now(),
      })
      subscriptions.delete(subscriptionId)
    },
  })

  subscriptions.set(subscriptionId, {
    subscriptionId,
    client,
    unsubscribe,
    windowId,
  })

  return subscriptionId
}

export function unsubscribe(subscriptionId: string): boolean {
  const managed = subscriptions.get(subscriptionId)
  if (!managed) {
    return false
  }

  managed.unsubscribe()
  managed.client.dispose()
  subscriptions.delete(subscriptionId)
  return true
}

export function unsubscribeAll(): void {
  for (const [id] of subscriptions) {
    unsubscribe(id)
  }
}

// CloseEvent type for ws error handler
interface CloseEvent {
  code: number
  reason: string
  wasClean: boolean
}
