/**
 * Mock-engine internal types.
 * These mirror the renderer-facing types in `src/renderer/types/index.ts`,
 * duplicated here so the main-process tsconfig (`tsconfig.node.json`) doesn't
 * have to pull renderer files into its program. Keep the two definitions in
 * sync — they cross the IPC boundary as JSON.
 */

export type MockMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS' | 'ANY'

export type MockPathMode = 'exact' | 'param' | 'wildcard' | 'regex'

export type MockBodyType = 'json' | 'xml' | 'text' | 'html'

export type MockConditionOp = 'eq' | 'neq' | 'contains' | 'regex' | 'exists'

export type MockCondition =
  | { type: 'always' }
  | { type: 'header'; name: string; op: MockConditionOp; value: string }
  | { type: 'query'; name: string; op: MockConditionOp; value: string }
  | { type: 'pathParam'; name: string; op: MockConditionOp; value: string }
  | { type: 'jsonPath'; path: string; op: MockConditionOp; value?: string }
  | { type: 'xpath'; expression: string; op: MockConditionOp; value?: string }
  | { type: 'method'; method: string }
  | { type: 'and'; conditions: MockCondition[] }
  | { type: 'or'; conditions: MockCondition[] }

export interface MockResponseHeader {
  name: string
  value: string
}

export type MockServerStatus = 'stopped' | 'starting' | 'running' | 'error'

export interface MockLogEntry {
  id: string
  serverId: string
  ts: number
  method: string
  path: string
  query: string
  statusCode: number
  latencyMs: number
  matchedEndpointId: string | null
  matchedResponseId: string | null
  request: { headers: Record<string, string>; body: string }
  response: { headers: Record<string, string>; body: string }
  error: string | null
}

// ─── Auth ───────────────────────────────────────────────────────

export type AuthConfig =
  | { type: 'none' }
  | { type: 'bearer'; tokens: string[] }
  | { type: 'basic'; users: { username: string; password: string }[] }
  | { type: 'apiKey'; in: 'header' | 'query'; name: string; keys: string[] }

// ─── Failure injection ──────────────────────────────────────────

export type FailureMode = 'status' | 'timeout' | 'random'

export interface FailureConfig {
  enabled: boolean
  /** 0–100. */
  probability: number
  mode: FailureMode
  /** Status code returned in `status` mode (default 500). */
  status?: number
  /** Timeout used in `timeout` mode — server delays for this many ms before responding. */
  timeoutMs?: number
}

// ─── Rate limit ─────────────────────────────────────────────────

export interface RateLimitConfig {
  enabled: boolean
  requestsPerWindow: number
  windowMs: number
  scope: 'global' | 'ip'
}

// ─── CORS extended ──────────────────────────────────────────────

export interface CorsConfig {
  enabled: boolean
  allowOrigins: string
  allowMethods: string
  allowHeaders: string
  allowCredentials: boolean
  maxAge: number
}

// ─── JSON Schema validation ─────────────────────────────────────

export interface SchemaValidation {
  enabled: boolean
  schema: Record<string, unknown>
}
