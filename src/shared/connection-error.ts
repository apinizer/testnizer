/**
 * Issue #253 — ONE connection-error format for WebSocket, Socket.IO, SSE, MCP
 * and MQTT: what happened + host:port (when there is one) + a next step.
 *
 * Pure TS, shared by both bundles:
 *  - main (`src/main/lib/error-classifier.ts`) classifies an engine error into
 *    a `ConnectionErrorInfo` and writes the English text with the table below;
 *  - the renderer (`src/renderer/lib/connection-error.ts`) writes the same
 *    composition in the active locale from the i18n keys
 *    `connError.<kind>.what` / `connError.<kind>.hint`.
 * Both go through `composeConnectionMessage` + `joinConnectionHint`, so the
 * English text the renderer shows is the string main sent — no drift.
 */

export const CONNECTION_ERROR_KINDS = [
  'refused',
  'dns',
  'timeout',
  'unreachable',
  'reset',
  'bad-port',
  'invalid-url',
  'tls-untrusted',
  'tls-expired',
  'tls-hostname',
  'tls',
  'unauthorized',
  'forbidden',
  'not-found',
  'http-status',
  'rejected',
  'closed',
  'aborted',
  'spawn-failed',
  'unknown',
] as const

export type ConnectionErrorKind = (typeof CONNECTION_ERROR_KINDS)[number]

export interface ConnectionErrorInfo {
  kind: ConnectionErrorKind
  /** `host:port` only — never userinfo, path or query. Absent for stdio / no host. */
  target?: string
  /** HTTP status of a failed handshake. */
  httpStatus?: number
  /** Node / libuv / SDK error code, kept for diagnostics. */
  code?: string
  /** The part only the server / SDK can tell (credentials scrubbed). */
  detail?: string
  /** English one-liner: `<what>[ (HTTP n)][ — target][: detail]`, no hint. */
  message: string
  /** English next step. */
  hint?: string
}

/**
 * The protocols whose failure is a SEND (one request with a request timeout),
 * not a connect (issue #309). A `requestHint` replaces `hint` for them; every
 * other protocol (WebSocket, Socket.IO, SSE, MCP, MQTT) and an unknown one
 * keeps the connect wording.
 */
export const REQUEST_PROTOCOLS = ['http', 'graphql', 'soap'] as const

export function isRequestProtocol(protocol: unknown): boolean {
  return typeof protocol === 'string' && (REQUEST_PROTOCOLS as readonly string[]).includes(protocol)
}

/**
 * English `what` + `hint` per kind (+ `requestHint` where a send reads
 * differently from a connect). The renderer's EN i18n block is built from
 * this table (`connectionErrorEnglishKeys`) — change wording here only.
 */
export const CONNECTION_ERROR_TEXT_EN: Record<
  ConnectionErrorKind,
  { what: string; hint?: string; requestHint?: string }
> = {
  refused: { what: 'Connection refused', hint: 'Check that the server is running' },
  dns: { what: 'DNS lookup failed', hint: 'Check the host name in the URL' },
  timeout: {
    what: 'Connection timed out',
    hint: 'Check the host and port; if the server is slow, raise the connect timeout in Settings',
    requestHint:
      'Check the host and port; if the server is slow, raise the request timeout in the request Settings tab, the project settings or app Settings',
  },
  unreachable: {
    what: 'Host unreachable',
    hint: 'Check the network connection, VPN or proxy settings',
  },
  reset: {
    what: 'Connection reset',
    hint: 'Check the URL scheme (ws/wss, http/https) and the server logs',
  },
  'bad-port': {
    what: 'Port not allowed',
    hint: 'This port is blocked for web connections; use another port',
  },
  'invalid-url': { what: 'Invalid URL', hint: 'Check the scheme, host and port in the URL' },
  'tls-untrusted': {
    what: 'TLS certificate not trusted',
    hint: 'Import the CA certificate in Settings or turn off SSL verification',
  },
  'tls-expired': {
    what: 'TLS certificate expired',
    hint: 'Renew the server certificate or turn off SSL verification',
  },
  'tls-hostname': {
    what: 'TLS hostname mismatch',
    hint: 'Use the host name on the certificate or turn off SSL verification',
  },
  tls: {
    what: 'TLS error',
    hint: 'Check the URL scheme and the server TLS settings',
  },
  unauthorized: {
    what: 'Authentication failed',
    hint: 'Check the credentials: Authorization header, token or username and password',
  },
  forbidden: {
    what: 'Access denied',
    hint: 'Use credentials that have access to this resource',
  },
  'not-found': { what: 'Endpoint not found', hint: 'Check the path in the URL' },
  'http-status': {
    what: 'Unexpected HTTP response',
    hint: 'Check the server logs and the URL',
  },
  rejected: {
    what: 'Server rejected the connection',
    hint: 'Check the auth data and the settings the server expects',
  },
  closed: {
    what: 'Connection closed',
    hint: 'Check the server logs and the connection settings',
  },
  aborted: { what: 'Connection aborted' },
  'spawn-failed': {
    what: 'Could not start the server command',
    hint: 'Check that the command is installed and on PATH',
  },
  unknown: { what: 'Connection failed' },
}

/** `connError.<kind>.what` / `.hint` → English text, for the renderer's EN i18n block. */
export function connectionErrorEnglishKeys(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const kind of CONNECTION_ERROR_KINDS) {
    const { what, hint, requestHint } = CONNECTION_ERROR_TEXT_EN[kind]
    out[`connError.${kind}.what`] = what
    if (hint) out[`connError.${kind}.hint`] = hint
    if (requestHint) out[`connError.${kind}.requestHint`] = requestHint
  }
  return out
}

/**
 * The i18n key of the next step for `kind` on `protocol`: the request variant
 * (`connError.<kind>.requestHint`) for an HTTP / GraphQL / SOAP send when the
 * kind has one, else `connError.<kind>.hint`. Main and renderer both decide
 * through this, so the English text main writes equals the renderer's.
 */
export function connectionHintKey(kind: ConnectionErrorKind, protocol?: unknown): string {
  return isRequestProtocol(protocol) && CONNECTION_ERROR_TEXT_EN[kind].requestHint
    ? `connError.${kind}.requestHint`
    : `connError.${kind}.hint`
}

/** English next step for `kind` on `protocol` (main's half of `connectionHintKey`). */
export function connectionHintEn(
  kind: ConnectionErrorKind,
  protocol?: unknown,
): string | undefined {
  const text = CONNECTION_ERROR_TEXT_EN[kind]
  return isRequestProtocol(protocol) && text.requestHint ? text.requestHint : text.hint
}

/**
 * `<what>[ (HTTP n)][ — target][: detail]`. An `unknown` failure without a
 * host is the raw text alone (the classifier's historical passthrough).
 */
export function composeConnectionMessage(
  info: Pick<ConnectionErrorInfo, 'kind' | 'target' | 'httpStatus' | 'detail'>,
  what: string,
): string {
  if (info.kind === 'unknown' && info.detail && !info.target) return info.detail
  let text = what
  if (typeof info.httpStatus === 'number') text += ` (HTTP ${info.httpStatus})`
  if (info.target) text += ` — ${info.target}`
  if (info.detail) text += `: ${info.detail}`
  return text
}

/** `message. hint` (no doubled period); `message` alone without a hint. */
export function joinConnectionHint(message: string, hint: string | undefined): string {
  if (!hint) return message
  return /[.!?]$/.test(message) ? `${message} ${hint}` : `${message}. ${hint}`
}

/** Type guard for an `errorInfo` that crossed IPC (old builds send none). */
export function isConnectionErrorInfo(value: unknown): value is ConnectionErrorInfo {
  if (!value || typeof value !== 'object') return false
  const v = value as { kind?: unknown; message?: unknown }
  return (
    typeof v.kind === 'string' &&
    (CONNECTION_ERROR_KINDS as readonly string[]).includes(v.kind) &&
    typeof v.message === 'string'
  )
}
