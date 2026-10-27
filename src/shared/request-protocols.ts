/**
 * Which saved requests the Runner and the HTTP mock server can take — ONE
 * rule for main (the Runner's step) and the renderer (the APIs tree's
 * "Create test suite / mock server from request", issue #284 audit), so the
 * menu never offers what the Runner would only mark 'unsupported'.
 */

/** Protocols the Runner sends through the HTTP engine (SOAP / GraphQL ride it too). */
const RUNNER_HTTP_LIKE: ReadonlySet<string> = new Set([
  'http',
  'https',
  'rest',
  'soap',
  'graphql',
  '',
])

const norm = (protocol: string | null | undefined): string => (protocol ?? '').toLowerCase()

/** HTTP-family rows: the Runner's HTTP-engine path. */
export function isRunnerHttpLike(protocol: string | null | undefined): boolean {
  return RUNNER_HTTP_LIKE.has(norm(protocol))
}

/**
 * A row the Runner executes: the HTTP family, plus MCP (its own step, issue
 * #161). Everything else (WebSocket, Socket.IO, gRPC, SSE, MQTT, AI Chat) is
 * reported 'unsupported' and skipped.
 */
export function isRunnableProtocol(protocol: string | null | undefined): boolean {
  return isRunnerHttpLike(protocol) || norm(protocol) === 'mcp'
}

/**
 * A row the HTTP mock server can stand in for: a method + path over HTTP —
 * the HTTP family and SSE (an SSE response body mode exists, issue #221).
 * MQTT / WebSocket / Socket.IO / gRPC are other wire protocols, MCP has its
 * own Mock MCP server and AI Chat its own LLM mock kind.
 */
export function isHttpMockableProtocol(protocol: string | null | undefined): boolean {
  return isRunnerHttpLike(protocol) || norm(protocol) === 'sse'
}
