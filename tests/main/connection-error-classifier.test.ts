/**
 * Issue #253 — ONE connection-error format for WebSocket, Socket.IO, SSE, MCP
 * and MQTT: what happened + host:port (when there is one) + a next step.
 *
 * ─── CONTRACT (the implementation must satisfy; tests below pin it) ──────────
 *
 * shared (pure TS, new) `src/shared/connection-error.ts`
 *   CONNECTION_ERROR_KINDS   readonly tuple of the stable `kind` codes:
 *     refused | dns | timeout | unreachable | reset | bad-port | invalid-url |
 *     tls-untrusted | tls-expired | tls-hostname | tls |
 *     unauthorized | forbidden | not-found | http-status |
 *     rejected | closed | aborted | spawn-failed | unknown
 *   ConnectionErrorKind      union of those
 *   ConnectionErrorInfo      { kind; target?; httpStatus?; code?; detail?;
 *                              message; hint? }
 *        message = `<what>[ (HTTP <httpStatus>)][ — <target>][: <detail>]`
 *                  (English, one line, NO hint; `what` is a fixed phrase per kind)
 *        hint    = the next step (English, no trailing sentence needed)
 *        target  = `host:port` ONLY (default port filled in from the scheme:
 *                  ws/http 80, wss/https 443, mqtt 1883, mqtts 8883; IPv6 as
 *                  `[::1]:8080`). Never userinfo, path or query. Absent for
 *                  stdio MCP and when nothing names a host.
 *        detail  = server/SDK text for `rejected` / `unknown` / `http-status`
 *                  (the part only the server can tell), credentials scrubbed.
 *
 * main `src/main/lib/error-classifier.ts` (EXTENDED, not a new formatter)
 *   classifyTransportError(err, ctx?)  → the old ClassifiedError PLUS
 *        kind, target?, detail?  (hint is now always the next step).
 *        ctx = { url?: string; protocol?: 'websocket'|'socketio'|'sse'|'mcp'|'mqtt'|'http';
 *                transport?: 'stdio' | 'http' | 'sse' }
 *        It normalises what the adapters used to lose: `cause` chains (undici
 *        `fetch failed`), `description` / `description.error` (socket.io-client),
 *        `SdkHttpError.status`, `ErrorEvent.code`, `ws` "Unexpected server
 *        response: NNN", MQTT.js CONNACK errors.
 *   formatConnectionError(info)  → `${message}. ${hint}` (just `message` w/o hint)
 *        — the string every engine puts in `Error.message`, the IPC `error` and
 *        the event `data`.
 *   class ConnectionError extends Error { info: ConnectionErrorInfo }
 *        message === formatConnectionError(info).
 *   toConnectionError(err, ctx?) → ConnectionError  (keeps `status`/`code`/`name`
 *        of the original so `isUnauthorized`-style checks still work).
 *   getConnectionErrorInfo(err: unknown) → ConnectionErrorInfo | undefined
 *
 * Credentials: userinfo (`user:pass@`) and credential-named query values
 * NEVER appear in message / hint / target / detail — the target is host:port
 * only, and a raw SDK message that embeds the URL is scrubbed.
 */
import { describe, expect, it } from 'vitest'
import {
  CONNECTION_ERROR_KINDS,
  type ConnectionErrorInfo,
} from '../../src/shared/connection-error'
import {
  ConnectionError,
  classifyTransportError,
  formatConnectionError,
  getConnectionErrorInfo,
  toConnectionError,
} from '../../src/main/lib/error-classifier'

const CANARY_PASS = 'Pa55w0rdCANARY'
const CANARY_TOKEN = 'TOKENCANARY'
const CANARY_USER = 'u5erCANARY'
const LEAKY_URL = `wss://${CANARY_USER}:${CANARY_PASS}@h.test:1/x?token=${CANARY_TOKEN}`

const e = (message: string, props: Record<string, unknown> = {}): Error =>
  Object.assign(new Error(message), props)
/** undici: `TypeError: fetch failed` with the real reason in `cause`. */
const fetchFailed = (cause: Error): TypeError =>
  Object.assign(new TypeError('fetch failed'), { cause })

function expectNoLeak(value: unknown): void {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  expect(text).not.toContain(CANARY_PASS)
  expect(text).not.toContain(CANARY_TOKEN)
  expect(text).not.toContain(CANARY_USER)
}

describe('shared kind catalogue', () => {
  it('lists the stable kind codes (renderer i18n keys are derived from them)', () => {
    expect([...CONNECTION_ERROR_KINDS].sort()).toEqual(
      [
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
      ].sort(),
    )
  })
})

describe('refused / dns / timeout / bad port — transport errors', () => {
  it('ws ECONNREFUSED: what + host:port, no repeated raw text', () => {
    const out = classifyTransportError(
      e('connect ECONNREFUSED 127.0.0.1:1', { code: 'ECONNREFUSED' }),
      { protocol: 'websocket', url: 'ws://127.0.0.1:1' },
    )
    expect(out.kind).toBe('refused')
    expect(out.target).toBe('127.0.0.1:1')
    // Was: "Connection refused — ECONNREFUSED connect ECONNREFUSED 127.0.0.1:1".
    expect(out.message).toBe('Connection refused — 127.0.0.1:1')
    expect(out.hint).toBeTruthy()
    expect(out.code).toBe('ECONNREFUSED')
  })

  it('the target is the URL host:port with the scheme default port filled in', () => {
    const dns = classifyTransportError(e('getaddrinfo ENOTFOUND nope.invalid', { code: 'ENOTFOUND' }), {
      protocol: 'websocket',
      url: 'wss://nope.invalid/x',
    })
    expect(dns.kind).toBe('dns')
    expect(dns.target).toBe('nope.invalid:443')
    expect(dns.message).toBe('DNS lookup failed — nope.invalid:443')

    const http = classifyTransportError(e('connect ECONNREFUSED ::1:80', { code: 'ECONNREFUSED' }), {
      url: 'http://localhost/',
    })
    expect(http.target).toBe('localhost:80')

    const mqtt = classifyTransportError(e('connect ECONNREFUSED 10.0.0.9:1883', { code: 'ECONNREFUSED' }), {
      protocol: 'mqtt',
      url: 'mqtt://broker.test',
    })
    expect(mqtt.target).toBe('broker.test:1883')
    const mqtts = classifyTransportError(e('connect ETIMEDOUT 10.0.0.9:8883', { code: 'ETIMEDOUT' }), {
      protocol: 'mqtt',
      url: 'mqtts://broker.test',
    })
    expect(mqtts.target).toBe('broker.test:8883')
    expect(mqtts.kind).toBe('timeout')

    const v6 = classifyTransportError(e('connect ECONNREFUSED ::1:8080', { code: 'ECONNREFUSED' }), {
      url: 'ws://[::1]:8080/',
    })
    expect(v6.target).toBe('[::1]:8080')
  })

  it('without a URL the target comes from the error (address/port or the message)', () => {
    const byProps = classifyTransportError(
      e('connect ECONNREFUSED 10.1.2.3:5555', {
        code: 'ECONNREFUSED',
        address: '10.1.2.3',
        port: 5555,
      }),
    )
    expect(byProps.target).toBe('10.1.2.3:5555')
    const byMessage = classifyTransportError(e('connect ECONNREFUSED 10.1.2.3:5555'))
    expect(byMessage.kind).toBe('refused')
    expect(byMessage.target).toBe('10.1.2.3:5555')
    const none = classifyTransportError(e('socket hang up', { code: 'ECONNRESET' }))
    expect(none.kind).toBe('reset')
    expect(none.target).toBeUndefined()
    expect(none.message).not.toMatch(/undefined/)
  })

  it('ETIMEDOUT / EHOSTUNREACH / ECONNRESET get their own kinds', () => {
    expect(
      classifyTransportError(e('connect ETIMEDOUT 10.0.0.1:80', { code: 'ETIMEDOUT' }), {
        url: 'http://10.0.0.1/',
      }).kind,
    ).toBe('timeout')
    const unreachable = classifyTransportError(
      e('connect EHOSTUNREACH 10.0.0.1:80', { code: 'EHOSTUNREACH' }),
      { url: 'http://10.0.0.1/' },
    )
    expect(unreachable.kind).toBe('unreachable')
    expect(unreachable.message).toMatch(/unreachable/i)
    expect(
      classifyTransportError(e('read ECONNRESET', { code: 'ECONNRESET' }), { url: 'http://h.test/' })
        .kind,
    ).toBe('reset')
  })

  it('undici "bad port" is NOT "connection refused" — its own kind', () => {
    const out = classifyTransportError(fetchFailed(e('bad port')), {
      protocol: 'sse',
      url: 'http://127.0.0.1:1/stream',
    })
    expect(out.kind).toBe('bad-port')
    expect(out.target).toBe('127.0.0.1:1')
    expect(out.message).toMatch(/port/i)
    expect(out.message).not.toMatch(/refused/i)
    expect(out.hint).toMatch(/port/i)
  })

  it('undici fetch failed unwraps cause.code (refused / dns / tls) — MCP & SSE', () => {
    const refused = classifyTransportError(
      fetchFailed(
        e('connect ECONNREFUSED 127.0.0.1:3000', {
          code: 'ECONNREFUSED',
          address: '127.0.0.1',
          port: 3000,
        }),
      ),
      { protocol: 'mcp', url: 'http://127.0.0.1:3000/mcp' },
    )
    expect(refused.kind).toBe('refused')
    expect(refused.target).toBe('127.0.0.1:3000')
    expect(refused.message).toBe('Connection refused — 127.0.0.1:3000')
    expect(refused.message).not.toMatch(/fetch failed/i)

    const dns = classifyTransportError(
      fetchFailed(e('getaddrinfo ENOTFOUND mcp.invalid', { code: 'ENOTFOUND' })),
      { protocol: 'mcp', url: 'https://mcp.invalid/mcp' },
    )
    expect(dns.kind).toBe('dns')
    expect(dns.target).toBe('mcp.invalid:443')

    const tls = classifyTransportError(
      fetchFailed(e('self-signed certificate', { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' })),
      { protocol: 'mcp', url: 'https://mcp.test/mcp' },
    )
    expect(tls.kind).toBe('tls-untrusted')
    expect(tls.target).toBe('mcp.test:443')
  })

  it('eventsource@3 ErrorEvent text ("TypeError: fetch failed: connect ECONNREFUSED …")', () => {
    const out = classifyTransportError(
      { type: 'error', message: 'TypeError: fetch failed: connect ECONNREFUSED 127.0.0.1:56296' },
      { protocol: 'sse', url: 'http://127.0.0.1:56296/' },
    )
    expect(out.kind).toBe('refused')
    expect(out.target).toBe('127.0.0.1:56296')
    expect(out.message).toBe('Connection refused — 127.0.0.1:56296')
  })

  it('eventsource@3 "fetch failed: bad port" text', () => {
    const out = classifyTransportError(
      { type: 'error', message: 'TypeError: fetch failed: bad port' },
      { protocol: 'sse', url: 'http://127.0.0.1:1/' },
    )
    expect(out.kind).toBe('bad-port')
  })

  it('invalid URL', () => {
    const out = classifyTransportError(e('Invalid URL', { code: 'ERR_INVALID_URL' }), {
      protocol: 'websocket',
    })
    expect(out.kind).toBe('invalid-url')
    expect(out.message).toMatch(/Invalid URL/)
  })
})

describe('TLS', () => {
  const cases: Array<[string, string, string]> = [
    ['DEPTH_ZERO_SELF_SIGNED_CERT', 'self signed certificate', 'tls-untrusted'],
    ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'unable to verify the first certificate', 'tls-untrusted'],
    ['CERT_HAS_EXPIRED', 'certificate has expired', 'tls-expired'],
    ['ERR_TLS_CERT_ALTNAME_INVALID', "Hostname/IP does not match certificate's altnames", 'tls-hostname'],
    ['ERR_SSL_WRONG_VERSION_NUMBER', 'wrong version number', 'tls'],
  ]
  for (const [code, message, kind] of cases) {
    it(`${code} → ${kind}, with host:port`, () => {
      const out = classifyTransportError(e(message, { code }), {
        protocol: 'websocket',
        url: 'wss://secure.test/x',
      })
      expect(out.kind).toBe(kind)
      expect(out.target).toBe('secure.test:443')
      expect(out.hint).toBeTruthy()
    })
  }
})

describe('HTTP status at the handshake', () => {
  const ws = (status: number) =>
    classifyTransportError(e(`Unexpected server response: ${status}`), {
      protocol: 'websocket',
      url: 'ws://h.test:9000/ws',
    })

  it('ws "Unexpected server response: 401/403/404/502"', () => {
    const a = ws(401)
    expect([a.kind, a.httpStatus, a.target]).toEqual(['unauthorized', 401, 'h.test:9000'])
    expect(a.message).toMatch(/401/)
    expect(a.hint).toMatch(/Authorization/i)
    const f = ws(403)
    expect([f.kind, f.httpStatus]).toEqual(['forbidden', 403])
    const n = ws(404)
    expect([n.kind, n.httpStatus]).toEqual(['not-found', 404])
    expect(n.hint).toMatch(/URL/i)
    const b = ws(502)
    expect([b.kind, b.httpStatus]).toEqual(['http-status', 502])
    expect(b.message).toMatch(/502/)
  })

  it('eventsource ErrorEvent { code: 401 } and axios-like { response.status }', () => {
    const es = classifyTransportError(
      { code: 401, message: 'Unauthorized' },
      { protocol: 'sse', url: 'http://h.test/stream' },
    )
    expect([es.kind, es.httpStatus, es.target]).toEqual(['unauthorized', 401, 'h.test:80'])
    const ax = classifyTransportError(
      { message: 'Request failed', response: { status: 404, statusText: 'Not Found' } },
      { url: 'http://h.test/x' },
    )
    expect([ax.kind, ax.httpStatus]).toEqual(['not-found', 404])
  })

  it('MCP SDK 2.x SdkHttpError carries the status in .status', () => {
    const sdk = (status: number) =>
      classifyTransportError(
        e(`Error POSTing to endpoint (HTTP ${status}): denied`, {
          name: 'SdkHttpError',
          status,
          code: 'CLIENT_HTTP_AUTHENTICATION',
        }),
        { protocol: 'mcp', url: 'https://mcp.test/mcp' },
      )
    const a = sdk(401)
    expect([a.kind, a.httpStatus, a.target]).toEqual(['unauthorized', 401, 'mcp.test:443'])
    expect(sdk(403).kind).toBe('forbidden')
    expect(sdk(404).kind).toBe('not-found')
    expect(sdk(503).kind).toBe('http-status')
    // The v1 transports put the status in a numeric .code.
    expect(
      classifyTransportError(e('SSE error: Non-200 status code (401)', { code: 401 }), {
        protocol: 'mcp',
        url: 'https://mcp.test/sse',
      }).kind,
    ).toBe('unauthorized')
  })
})

describe('Socket.IO connect_error', () => {
  /** What socket.io-client 4 hands over for a refused WebSocket transport. */
  const sioWebsocketError = (url: string, port: number): Error =>
    e('websocket error', {
      type: 'TransportError',
      description: {
        type: 'error',
        message: `connect ECONNREFUSED 127.0.0.1:${port}`,
        error: e(`connect ECONNREFUSED 127.0.0.1:${port}`, {
          code: 'ECONNREFUSED',
          address: '127.0.0.1',
          port,
        }),
        target: { _url: `${url}/socket.io/?EIO=4&transport=websocket` },
      },
    })

  it('"websocket error" wrapping ECONNREFUSED → refused with host:port', () => {
    const out = classifyTransportError(sioWebsocketError('ws://127.0.0.1:3300', 3300), {
      protocol: 'socketio',
      url: 'http://127.0.0.1:3300',
    })
    expect(out.kind).toBe('refused')
    expect(out.target).toBe('127.0.0.1:3300')
    expect(out.message).toBe('Connection refused — 127.0.0.1:3300')
    expect(out.message).not.toMatch(/websocket error/i)
  })

  it('the cause alone (no ctx url) still yields the target', () => {
    const out = classifyTransportError(sioWebsocketError('ws://127.0.0.1:3300', 3300), {
      protocol: 'socketio',
    })
    expect(out.kind).toBe('refused')
    expect(out.target).toBe('127.0.0.1:3300')
  })

  it('long-polling "xhr poll error" (description = XHR status 0) → unreachable, host from the URL', () => {
    const out = classifyTransportError(
      e('xhr poll error', { type: 'TransportError', description: 0, context: {} }),
      { protocol: 'socketio', url: 'https://sio.test/chat' },
    )
    expect(out.kind).toBe('unreachable')
    expect(out.target).toBe('sio.test:443')
    expect(out.message).not.toMatch(/xhr poll error/i)
  })

  it('a middleware refusal (not a transport error) is "rejected" and keeps the server text', () => {
    const out = classifyTransportError(e('invalid token', { data: { code: 'E_AUTH' } }), {
      protocol: 'socketio',
      url: 'http://sio.test:3300',
    })
    expect(out.kind).toBe('rejected')
    expect(out.target).toBe('sio.test:3300')
    expect(out.detail).toBe('invalid token')
    expect(out.message).toBe('Server rejected the connection — sio.test:3300: invalid token')
  })
})

describe('MQTT', () => {
  it('ECONNREFUSED from MQTT.js', () => {
    const out = classifyTransportError(
      e('connect ECONNREFUSED 127.0.0.1:1883', { code: 'ECONNREFUSED' }),
      { protocol: 'mqtt', url: 'mqtt://127.0.0.1:1883' },
    )
    expect(out.kind).toBe('refused')
    expect(out.target).toBe('127.0.0.1:1883')
  })

  it('CONNACK 4 / 5 (and v5 134 / 135) are authentication failures, not "connection refused"', () => {
    for (const [message, code] of [
      ['Connection refused: Bad username or password', 4],
      ['Connection refused: Not authorized', 5],
      ['Bad username or password', 134],
      ['Not authorized', 135],
    ] as const) {
      const out = classifyTransportError(e(message, { code }), {
        protocol: 'mqtt',
        url: 'mqtt://broker.test',
      })
      expect(out.kind, message).toBe('unauthorized')
      expect(out.target).toBe('broker.test:1883')
      expect(out.message, message).not.toMatch(/^Connection refused/)
    }
  })

  it('other CONNACK refusals are "rejected" and keep the broker reason as detail', () => {
    const out = classifyTransportError(e('Connection refused: Identifier rejected', { code: 2 }), {
      protocol: 'mqtt',
      url: 'mqtt://broker.test',
    })
    expect(out.kind).toBe('rejected')
    expect(out.detail).toMatch(/Identifier rejected/)
  })

  it('"Connection closed before the broker accepted it" → closed', () => {
    const out = classifyTransportError(e('Connection closed before the broker accepted it'), {
      protocol: 'mqtt',
      url: 'mqtt://broker.test',
    })
    expect(out.kind).toBe('closed')
    expect(out.target).toBe('broker.test:1883')
  })
})

describe('stdio MCP has no host:port', () => {
  it('a missing command is "spawn-failed", names the executable, has no target', () => {
    const out = classifyTransportError(
      e('spawn definitely-not-a-command ENOENT', {
        code: 'ENOENT',
        syscall: 'spawn definitely-not-a-command',
        path: 'definitely-not-a-command',
      }),
      { protocol: 'mcp', transport: 'stdio' },
    )
    expect(out.kind).toBe('spawn-failed')
    expect(out.target).toBeUndefined()
    expect(out.message).toContain('definitely-not-a-command')
    expect(out.message).not.toMatch(/:\d+/)
    expect(out.hint).toBeTruthy()
  })

  it('the real SDK shape: only message + code (no path / syscall)', () => {
    const out = classifyTransportError(e('spawn nope-cmd-253 ENOENT', { code: 'ENOENT' }), {
      protocol: 'mcp',
      transport: 'stdio',
    })
    expect(out.kind).toBe('spawn-failed')
    expect(out.message).toContain('nope-cmd-253')
    expect(out.target).toBeUndefined()
  })

  it('the legacy SSE transport reports the fetch failure as plain text', () => {
    const out = classifyTransportError(
      e('SSE error: TypeError: fetch failed: connect ECONNREFUSED 127.0.0.1:57374'),
      { protocol: 'mcp', transport: 'sse', url: 'http://127.0.0.1:57374/sse' },
    )
    expect(out.kind).toBe('refused')
    expect(out.message).toBe('Connection refused — 127.0.0.1:57374')
  })

  it('the server process exiting ("Connection closed") is "closed" with no target', () => {
    const out = classifyTransportError(e('MCP error -32000: Connection closed'), {
      protocol: 'mcp',
      transport: 'stdio',
    })
    expect(out.kind).toBe('closed')
    expect(out.target).toBeUndefined()
  })
})

describe('no credential leak', () => {
  it('uses host:port of the URL only — userinfo and query token never appear', () => {
    const out = classifyTransportError(e('connect ECONNREFUSED 10.0.0.2:1', { code: 'ECONNREFUSED' }), {
      protocol: 'websocket',
      url: LEAKY_URL,
    })
    expect(out.target).toBe('h.test:1')
    expectNoLeak(out)
    expectNoLeak(formatConnectionError(out as ConnectionErrorInfo))
  })

  it('a raw SDK message that embeds the URL is scrubbed (unknown + http-status + rejected)', () => {
    const unknown = classifyTransportError(
      e(`something odd while talking to ${LEAKY_URL} (retry later)`),
      { protocol: 'mcp', url: LEAKY_URL },
    )
    expect(unknown.kind).toBe('unknown')
    expect(unknown.message).toMatch(/something odd/)
    expectNoLeak(unknown)

    const rejected = classifyTransportError(e(`denied for ${LEAKY_URL}`, { data: {} }), {
      protocol: 'socketio',
      url: LEAKY_URL,
    })
    expectNoLeak(rejected)

    const sdk = classifyTransportError(
      e(`Error POSTing to endpoint ${LEAKY_URL} (HTTP 502): bad gateway`, {
        name: 'SdkHttpError',
        status: 502,
      }),
      { protocol: 'mcp', url: LEAKY_URL },
    )
    expect(sdk.kind).toBe('http-status')
    expectNoLeak(sdk)
  })

  it('the leak guard also holds for every transport branch', () => {
    const errors = [
      e('getaddrinfo ENOTFOUND h.test', { code: 'ENOTFOUND' }),
      e('connect ETIMEDOUT 1.1.1.1:1', { code: 'ETIMEDOUT' }),
      fetchFailed(e('bad port')),
      e('Unexpected server response: 401'),
      e('self signed certificate', { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' }),
    ]
    for (const err of errors) {
      expectNoLeak(classifyTransportError(err, { protocol: 'websocket', url: LEAKY_URL }))
    }
  })
})

describe('fallbacks and the Error wrapper', () => {
  it('unknown shapes keep their text, kind "unknown"', () => {
    const out = classifyTransportError(e('generic failure'), { protocol: 'sse', url: 'http://h.test/' })
    expect(out.kind).toBe('unknown')
    expect(out.message).toContain('generic failure')
    expect(classifyTransportError(null).kind).toBe('unknown')
    expect(classifyTransportError('something broke').message).toBe('something broke')
  })

  it('abort → aborted', () => {
    expect(classifyTransportError(e('The operation was aborted', { name: 'AbortError' })).kind).toBe(
      'aborted',
    )
  })

  it('every kind but unknown/aborted carries a next-step hint', () => {
    const samples: Array<[unknown, string]> = [
      [e('connect ECONNREFUSED 1.1.1.1:1', { code: 'ECONNREFUSED' }), 'refused'],
      [e('getaddrinfo ENOTFOUND x.test', { code: 'ENOTFOUND' }), 'dns'],
      [e('connect ETIMEDOUT 1.1.1.1:1', { code: 'ETIMEDOUT' }), 'timeout'],
      [e('connect EHOSTUNREACH 1.1.1.1:1', { code: 'EHOSTUNREACH' }), 'unreachable'],
      [e('read ECONNRESET', { code: 'ECONNRESET' }), 'reset'],
      [fetchFailed(e('bad port')), 'bad-port'],
      [e('Invalid URL', { code: 'ERR_INVALID_URL' }), 'invalid-url'],
      [e('x', { code: 'CERT_HAS_EXPIRED' }), 'tls-expired'],
      [e('Unexpected server response: 401'), 'unauthorized'],
      [e('Unexpected server response: 403'), 'forbidden'],
      [e('Unexpected server response: 404'), 'not-found'],
      [e('Unexpected server response: 500'), 'http-status'],
      [e('Connection closed before the broker accepted it'), 'closed'],
    ]
    for (const [err, kind] of samples) {
      const out = classifyTransportError(err, { url: 'http://h.test:80/' })
      expect(out.kind).toBe(kind)
      expect(out.hint, kind).toBeTruthy()
    }
  })

  it('toConnectionError wraps with .info, message = formatConnectionError(info), keeps status/code/name', () => {
    const original = e('Error POSTing (HTTP 401)', {
      name: 'SdkHttpError',
      status: 401,
      code: 'CLIENT_HTTP_AUTHENTICATION',
    })
    const wrapped = toConnectionError(original, { protocol: 'mcp', url: 'https://mcp.test/mcp' })
    expect(wrapped).toBeInstanceOf(ConnectionError)
    expect(wrapped).toBeInstanceOf(Error)
    expect(wrapped.info.kind).toBe('unauthorized')
    expect(wrapped.message).toBe(formatConnectionError(wrapped.info))
    expect((wrapped as unknown as { status: number }).status).toBe(401)
    expect((wrapped as unknown as { code: unknown }).code).toBe('CLIENT_HTTP_AUTHENTICATION')
    expect(getConnectionErrorInfo(wrapped)).toEqual(wrapped.info)
    expect(getConnectionErrorInfo(new Error('plain'))).toBeUndefined()
    expect(getConnectionErrorInfo(undefined)).toBeUndefined()
    // Idempotent: wrapping a wrapped error keeps the first classification.
    expect(toConnectionError(wrapped, { protocol: 'mcp' }).info).toEqual(wrapped.info)
  })

  it('formatConnectionError: message, then ". hint"', () => {
    expect(
      formatConnectionError({ kind: 'unknown', message: 'Connection failed' } as ConnectionErrorInfo),
    ).toBe('Connection failed')
    expect(
      formatConnectionError({
        kind: 'refused',
        message: 'Connection refused — h:1',
        hint: 'Start the server',
      } as ConnectionErrorInfo),
    ).toBe('Connection refused — h:1. Start the server')
  })
})
