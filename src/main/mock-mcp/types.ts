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

/**
 * Multi-round-trip elicitation (protocol revision 2026-07-28, "MRTR"): a call
 * without `inputResponses` is answered `input_required` with one embedded
 * `elicitation/create` keyed `key`; the client's retry carries the answer,
 * whose accepted content is exposed to the response template as
 * `{{input.<field>}}`. `schema` is the restricted elicitation JSON Schema (an
 * object of string / number / integer / boolean / enum properties).
 * 2025-era callers get a text result explaining that elicitation needs
 * 2026-07-28 — the mock never pushes a server-initiated `elicitation/create`.
 */
export interface MockMcpElicit {
  key: string
  message: string
  schema: JsonSchemaObject
  /** Rendered instead of `response.body` once the input arrived (template). */
  responseTemplate?: string
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
  /** Ask the client for input before answering (2026-07-28 only). */
  elicit?: MockMcpElicit
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

/** The two MCP protocol eras: 2024/2025 (`initialize` handshake) and 2026-07-28+. */
export type MockMcpEra = 'legacy' | 'modern'

/**
 * How 2025-era (`initialize`) traffic on `<path>` is served next to the
 * 2026-07-28 stateless protocol:
 *   - `stateless`: every legacy POST gets a fresh server, no `Mcp-Session-Id`;
 *     legacy GET (notification stream) and DELETE answer 405, so a 2025
 *     client receives no `list_changed` notifications (`legacyNotifications`
 *     on the state is `false`).
 *   - `reject`: modern-only — legacy requests get the spec's
 *     `UnsupportedProtocolVersion` (-32022) error.
 */
export type MockMcpLegacyMode = 'stateless' | 'reject'

/** `list_changed` families the server can announce (`mockMcp:server:notify`). */
export type MockMcpNotifyKind = 'tools' | 'resources' | 'prompts'

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
  /**
   * Protocol pin (`?rev=<version>` on the URL overrides it per request).
   * A 2025-era version: `initialize` with any other version is rejected and
   * 2026-07-28 requests get -32022. `2026-07-28`: modern-only (legacy
   * requests get -32022, like `legacyMode: 'reject'`).
   */
  protocolPin: string | null
  /** 2025-era serving posture on `<path>` (see {@link MockMcpLegacyMode}). */
  legacyMode: MockMcpLegacyMode
  /**
   * `ttlMs` advertised on the cacheable list results (tools / prompts /
   * resources / resource templates) of 2026-07-28 responses, `cacheScope`
   * `private`. 0 (default) = immediately stale.
   */
  cacheTtlMs: number
  /**
   * RFC 9728 `authorization_servers` advertised by the bearer-mode
   * `/.well-known/oauth-protected-resource` document (default `[]`). Runtime
   * only — not persisted; lets the OAuth 2.1 debugger (issue #141) be pointed
   * at an external authorization server in tests.
   */
  authorizationServers?: string[]
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
  /** Protocol eras `<path>` currently answers (pin / `legacyMode` applied). */
  eras: MockMcpEra[]
  /**
   * UI hint, always `false`: 2025-era clients on `<path>` are served
   * statelessly (GET / DELETE → 405), so they never receive server
   * notifications such as `list_changed`. 2026-07-28 clients get them via
   * `subscriptions/listen`; legacy SSE sessions (`sseUrl`) still get them.
   */
  legacyNotifications: false
}

/**
 * `streamable-http`: a 2026-07-28 request on `<path>`; `stateless`: a 2025-era
 * request on `<path>` (served without a session); `sse`: legacy HTTP+SSE.
 */
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
  /** Legacy SSE session id (Streamable HTTP is stateless per request). */
  sessionId?: string
  transport?: MockMcpTransportKind
  /** Protocol era the request was classified into. */
  era?: MockMcpEra
  /** The `Mcp-Method` request header (2026-07-28 clients send it). */
  mcpMethod?: string
  /** The call paused for client input (`input_required` result). */
  inputRequired?: boolean
  /** JSON text, truncated. */
  request: string
  /** JSON text, truncated; a short note when no response was sent. */
  response: string
}
