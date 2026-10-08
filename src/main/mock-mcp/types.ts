/**
 * Mock MCP Server — plain-JSON configuration types (issue #140).
 *
 * One configurable, offline MCP server type that covers the scenarios the
 * public mock servers split across six hosts (echo, auth-required 401, error
 * kinds, complex schemas, stateless clients): tools / resources / prompts are
 * data, scenarios (bearer auth, latency, error injection, protocol pin) are
 * knobs on the server row.
 *
 * Everything here is JSON-serialisable on purpose: rows store it in JSON
 * columns, the project file carries it verbatim, and the renderer copies
 * these shapes for its editor.
 */

/** A JSON Schema object as authored by the user. Passed to clients VERBATIM. */
export type JsonSchemaObject = Record<string, unknown>

export type MockMcpErrorKind = 'none' | 'jsonrpc' | 'isError' | 'timeout' | 'http'

/**
 * Error injection for `tools/call`.
 *   - `jsonrpc`: JSON-RPC error response (`code`, default -32603; `message`).
 *   - `isError`: a normal CallToolResult with `isError: true` (`message` text).
 *   - `timeout`: the call never gets a response (until the client cancels or
 *                the session / server closes).
 *   - `http`:    the HTTP POST carrying the call is answered with `httpStatus`
 *                (default 500) instead of a JSON-RPC message.
 * `everyN` > 1 applies the error to every Nth call only (counted per server for
 * the server-level mode, per tool for a tool override); otherwise every call.
 */
export interface MockMcpErrorMode {
  kind: MockMcpErrorKind
  code?: number
  message?: string
  httpStatus?: number
  everyN?: number
}

export type MockMcpResponseKind = 'text' | 'json' | 'template'

export interface MockMcpToolResponse {
  /**
   * `text` → one text content block. `json` → the body as text PLUS
   * `structuredContent` (a non-object JSON value is wrapped as `{ result }`,
   * because the spec requires an object). `template` → Handlebars render with
   * `{{args.x}}`, `{{now}}`, `{{uuid}}`, `{{$randomUUID}}`, env vars … → text.
   */
  kind: MockMcpResponseKind
  body: string
  isError?: boolean
}

export interface MockMcpTool {
  name: string
  title?: string
  description?: string
  /** Advertised as-is in tools/list and used to validate call arguments. */
  inputSchema: JsonSchemaObject
  response: MockMcpToolResponse
  /** Extra per-tool delay, on top of the server's `latencyMs`. */
  delayMs?: number
  /** Per-tool override of the server's error mode (`kind:'none'` disables it). */
  error?: MockMcpErrorMode
}

/**
 * A static resource (`uri`) or a resource template (`uriTemplate`, RFC 6570
 * level-1 `{var}`). Exactly one of the two is set. Template text is rendered
 * with `{{params.var}}` from the matched URI.
 */
export interface MockMcpResource {
  uri?: string
  uriTemplate?: string
  name: string
  title?: string
  description?: string
  mimeType?: string
  text?: string
  /** Base64 payload; used when `text` is absent. */
  blob?: string
}

export interface MockMcpPromptArgument {
  name: string
  description?: string
  required?: boolean
}

export interface MockMcpPromptMessage {
  role: 'user' | 'assistant'
  /** Rendered with `{{args.x}}` from the prompts/get arguments. */
  text: string
}

export interface MockMcpPrompt {
  name: string
  title?: string
  description?: string
  arguments?: MockMcpPromptArgument[]
  messages: MockMcpPromptMessage[]
}

export type MockMcpAuthMode = 'none' | 'bearer'

/** What the live server runs from. Built from a DB row by the handler. */
export interface MockMcpServerDef {
  id: string
  name: string
  description: string
  host: string
  /** 0 = ephemeral; the bound port is reported by status(). */
  port: number
  /** Streamable HTTP endpoint, e.g. `/mcp`. Legacy SSE lives at `<path>/sse`. */
  path: string
  legacySse: boolean
  authMode: MockMcpAuthMode
  bearerToken: string
  latencyMs: number
  errorMode: MockMcpErrorMode
  /** Advertised protocol version; initialize with any other version is rejected. */
  protocolPin: string | null
  tools: MockMcpTool[]
  resources: MockMcpResource[]
  prompts: MockMcpPrompt[]
  /** Env-var scope for templates (`{{baseUrl}}`), same source as the HTTP mock. */
  projectId?: string
  workspaceId?: string
}

/** Renderer-facing view of a `mock_mcp_servers` row. */
export interface MockMcpServerConfig extends Omit<MockMcpServerDef, 'projectId' | 'workspaceId'> {
  projectId: string
  enabled: boolean
  createdAt: number
  updatedAt: number
}

export type MockMcpServerStatus = 'stopped' | 'starting' | 'running' | 'error'

export interface MockMcpServerState {
  serverId: string
  status: MockMcpServerStatus
  /** Bound port while running (differs from the configured one when that is 0). */
  port: number | null
  /** Streamable HTTP URL while running. */
  url: string | null
  /** Legacy SSE URL while running with `legacySse`. */
  sseUrl: string | null
  errorMessage: string | null
}

export type MockMcpTransportKind = 'streamable-http' | 'stateless' | 'sse'

/** One JSON-RPC request (or an HTTP-level rejection of one). Ring buffer of 500. */
export interface MockMcpLogEntry {
  id: string
  serverId: string
  ts: number
  /** JSON-RPC method, or `HTTP <verb>` when the body was not a JSON-RPC request. */
  method: string
  toolName?: string
  durationMs: number
  ok: boolean
  /** JSON-RPC error code when the response was an error. */
  errorCode?: number
  /** Set when the request was answered at the HTTP layer (401, error mode `http`, …). */
  httpStatus?: number
  sessionId?: string
  transport?: MockMcpTransportKind
  /** JSON text, truncated. */
  request: string
  /** JSON text, truncated; a short note when no response was sent. */
  response: string
}
