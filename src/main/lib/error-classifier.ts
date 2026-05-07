/**
 * Shared transport-layer error classifier.
 *
 * Goal: turn the cryptic shapes thrown by axios / `ws` / `eventsource` /
 * `@grpc/grpc-js` / `fetch` into a single human-readable message + structured
 * fields the UI can surface (status badge, hint banner, gRPC code lookup).
 *
 * Each engine catches → calls `classifyTransportError(err)` → attaches the
 * resulting message to its `ApiResponse.error` (or pushes it onto the
 * renderer event payload). UI components render the message verbatim and can
 * additionally highlight `httpStatus` / `code` / `grpcStatus` when present.
 */
export interface ClassifiedError {
  /** Single-line user-facing message (already includes any prefix/hint). */
  message: string
  /** Optional human-readable hint about the likely fix. */
  hint?: string
  /** HTTP status code when the failure carried one (axios response, fetch handshake). */
  httpStatus?: number
  /** Node.js / libuv error code when the failure was a transport error. */
  code?: string
  /** gRPC status code when the failure was a gRPC-layer error. */
  grpcStatus?: number
}

// ─── HTTP status hints ──────────────────────────────────────

const HTTP_STATUS_HINTS: Record<number, string> = {
  400: 'Bad Request — check headers / query params / body',
  401: 'Unauthorized — check Authorization header / token',
  403: 'Forbidden — credentials lack access to this resource',
  404: 'Not Found — check the URL',
  405: 'Method Not Allowed — server does not expose this method here',
  408: 'Request Timeout',
  409: 'Conflict',
  413: 'Payload Too Large',
  415: 'Unsupported Media Type — check Content-Type',
  422: 'Unprocessable Entity — request body validation failed',
  429: 'Too Many Requests — rate limited',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
}

export function hintForHttpStatus(status: number): string | undefined {
  return HTTP_STATUS_HINTS[status]
}

// ─── Transport error code hints ─────────────────────────────

interface CodeHint {
  pattern: RegExp
  /** Returned message prefix; the original raw message is appended in parens. */
  format: (raw: string) => { message: string; hint?: string }
}

const TRANSPORT_HINTS: CodeHint[] = [
  {
    pattern: /ECONNREFUSED/i,
    format: (raw) => ({
      message: `Connection refused — ${raw}`,
      hint: 'Server is not listening on the target host:port',
    }),
  },
  {
    pattern: /ECONNRESET/i,
    format: (raw) => ({
      message: `Connection reset — ${raw}`,
      hint: 'Server closed the connection unexpectedly',
    }),
  },
  {
    pattern: /ENOTFOUND|EAI_AGAIN/i,
    format: (raw) => ({
      message: `DNS lookup failed — ${raw}`,
      hint: 'Hostname could not be resolved',
    }),
  },
  {
    pattern: /ETIMEDOUT|ESOCKETTIMEDOUT|timeout of \d+ms exceeded/i,
    format: (raw) => ({
      message: `Connection timed out — ${raw}`,
      hint: 'Server did not respond in time',
    }),
  },
  {
    pattern: /EHOSTUNREACH|ENETUNREACH/i,
    format: (raw) => ({
      message: `Host unreachable — ${raw}`,
      hint: 'Network route to the host is unavailable',
    }),
  },
  {
    pattern: /EPIPE/i,
    format: (raw) => ({ message: `Broken pipe — ${raw}` }),
  },
  {
    pattern: /CERT_HAS_EXPIRED/i,
    format: (raw) => ({
      message: `TLS certificate expired — ${raw}`,
      hint: 'The server certificate is past its validity date',
    }),
  },
  {
    pattern: /DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_VERIFY_LEAF_SIGNATURE|UNABLE_TO_GET_ISSUER_CERT/i,
    format: (raw) => ({
      message: `TLS certificate not trusted — ${raw}`,
      hint: 'Disable SSL verification or import the CA in Settings',
    }),
  },
  {
    pattern: /ERR_TLS_CERT_ALTNAME_INVALID/i,
    format: (raw) => ({
      message: `TLS hostname mismatch — ${raw}`,
      hint: 'Certificate does not cover the requested hostname',
    }),
  },
  {
    pattern: /CERT|TLS|SSL/i,
    format: (raw) => ({ message: `TLS error — ${raw}` }),
  },
  {
    pattern: /ERR_INVALID_URL/i,
    format: (raw) => ({
      message: `Invalid URL — ${raw}`,
      hint: 'Check protocol scheme and host',
    }),
  },
  {
    pattern: /aborted|AbortError/i,
    format: (raw) => ({ message: `Request aborted — ${raw}` }),
  },
]

function describeTransportMessage(raw: string): { message: string; hint?: string } | null {
  for (const h of TRANSPORT_HINTS) {
    if (h.pattern.test(raw)) return h.format(raw)
  }
  return null
}

// ─── gRPC status code hints ─────────────────────────────────

const GRPC_STATUS_HINTS: Record<number, { name: string; hint: string }> = {
  0: { name: 'OK', hint: 'Success' },
  1: { name: 'CANCELLED', hint: 'Operation was cancelled by the caller' },
  2: { name: 'UNKNOWN', hint: 'Unknown server-side error' },
  3: { name: 'INVALID_ARGUMENT', hint: 'Request payload is malformed for this method' },
  4: { name: 'DEADLINE_EXCEEDED', hint: 'Server did not respond before the deadline' },
  5: { name: 'NOT_FOUND', hint: 'The requested resource was not found' },
  6: { name: 'ALREADY_EXISTS', hint: 'The resource already exists' },
  7: { name: 'PERMISSION_DENIED', hint: 'Caller is not authorized for this operation' },
  8: { name: 'RESOURCE_EXHAUSTED', hint: 'Server resource limit hit (rate-limit / quota)' },
  9: { name: 'FAILED_PRECONDITION', hint: 'System is not in a state required for the operation' },
  10: { name: 'ABORTED', hint: 'Operation was aborted (concurrency / transaction)' },
  11: { name: 'OUT_OF_RANGE', hint: 'Operation attempted past the valid range' },
  12: { name: 'UNIMPLEMENTED', hint: 'Method is not implemented on the server' },
  13: { name: 'INTERNAL', hint: 'Internal server error' },
  14: { name: 'UNAVAILABLE', hint: 'Service is unavailable — server may be down or unreachable' },
  15: { name: 'DATA_LOSS', hint: 'Unrecoverable data loss or corruption' },
  16: { name: 'UNAUTHENTICATED', hint: 'Caller is missing valid authentication credentials' },
}

export function describeGrpcStatus(code: number, details?: string): ClassifiedError {
  const entry = GRPC_STATUS_HINTS[code]
  const name = entry?.name ?? `CODE_${code}`
  const hint = entry?.hint
  const tail = details && details.trim() ? ` — ${details.trim()}` : ''
  return {
    message: `gRPC ${code} ${name}${tail}`,
    hint,
    grpcStatus: code,
  }
}

// ─── Main classifier ────────────────────────────────────────

interface AxiosLikeError {
  message?: unknown
  code?: unknown
  response?: { status?: unknown; statusText?: unknown }
}

/**
 * Best-effort transport error classifier. Accepts axios errors, plain `Error`
 * objects, and the loosely-typed `Event`-like payloads from `eventsource@2`.
 *
 * The message format is `<prefix> — <raw>` so the original error text is
 * always preserved (helps with diagnosis), while the prefix turns the raw
 * libuv code into something a non-Node user can act on.
 */
export function classifyTransportError(err: unknown): ClassifiedError {
  if (err === null || err === undefined) {
    return { message: 'Unknown error' }
  }

  // Plain string passthrough.
  if (typeof err === 'string') {
    const transport = describeTransportMessage(err)
    if (transport) return transport
    return { message: err }
  }

  const axiosErr = err as AxiosLikeError

  // Axios response error → http status path.
  const status = axiosErr.response?.status
  if (typeof status === 'number') {
    const statusText =
      typeof axiosErr.response?.statusText === 'string' ? axiosErr.response.statusText : ''
    const hint = hintForHttpStatus(status)
    const tail = hint ?? statusText
    return {
      message: tail ? `HTTP ${status} ${tail}` : `HTTP ${status}`,
      hint,
      httpStatus: status,
    }
  }

  // Code-bearing transport error (axios / Node).
  const rawCode = typeof axiosErr.code === 'string' ? axiosErr.code : undefined
  const rawMessage =
    typeof axiosErr.message === 'string' && axiosErr.message.trim()
      ? axiosErr.message.trim()
      : ''
  const probe = rawCode ? `${rawCode} ${rawMessage}` : rawMessage

  if (probe) {
    const transport = describeTransportMessage(probe)
    if (transport) {
      return { ...transport, code: rawCode }
    }
    return { message: rawMessage || rawCode || 'Transport error', code: rawCode }
  }

  return { message: 'Unknown transport error' }
}
