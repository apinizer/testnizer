/**
 * Review findings on commit 9fcd897 (issue #253), orchestrator review round W2.
 *
 *  P0-2  `scrubConnectionText` (src/main/lib/error-classifier.ts) decides which
 *        connect-URL query values to blank with the HEADER-name rule
 *        (`isCredentialHeaderName`). `?sig=…` (Azure SAS / presigned URLs) is a
 *        credential by the shared ARGUMENT rule (`isCredentialArgName`, which
 *        has `sig` as a whole word) but not by the header rule (`signature`
 *        is a substring match, `sig` is not). A server / SDK error text that
 *        echoes the value ("Invalid signature SECRETCANARY") then reaches the
 *        formatted message / errorInfo detail. `?api_key=` and
 *        `?access_token=` are caught by both rules (guards).
 *  P1-3  MCP `fail()` (src/main/protocols/mcp.engine.ts) keeps a server's
 *        JSON-RPC answer verbatim only when the classified kind is `unknown` /
 *        `http-status`. A -32602 "Invalid URL in server configuration" matches
 *        the transport rule `\bInvalid URL\b`, is classified `invalid-url`, and
 *        is rewritten into the generic "invalid URL" message + hint - the
 *        server's own explanation is lost.
 *  P2-5  MQTT: a broker that accepts TCP but never sends CONNACK makes MQTT.js
 *        emit Error('connack timeout'). The classifier has no rule for it, so
 *        it becomes kind `unknown` with detail "connack timeout" instead of the
 *        standard `timeout` kind + hint.
 *
 * Each describe states whether the finding reproduces; red tests are the
 * regression tests for the fix.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import net from 'node:net'
import {
  classifyTransportError,
  formatConnectionError,
  getConnectionErrorInfo,
  scrubConnectionText,
} from '../../src/main/lib/error-classifier'
import { mcpConnect, mcpDisconnectAll } from '../../src/main/protocols/mcp.engine'
import { mqttConnect, mqttDisconnectAll } from '../../src/main/protocols/mqtt.engine'

const CANARY = 'SECRETCANARY'

afterEach(() => {
  mcpDisconnectAll()
  mqttDisconnectAll()
})

// ─── P0-2: credential query names use the ARGUMENT rule ──────────

describe('P0-2: connect-URL query credentials are scrubbed from server / SDK text', () => {
  const NAMES = ['sig', 'api_key', 'access_token']

  it.each(NAMES)(
    'scrubConnectionText blanks the ?%s= value wherever the text echoes it',
    (name) => {
      const url = `https://mcp.test/mcp?${name}=${CANARY}`
      const out = scrubConnectionText(`Invalid signature ${CANARY} for the request`, url)
      expect(out).not.toContain(CANARY)
    },
  )

  it.each(NAMES)(
    'a JSON-RPC -32602 text echoing the ?%s= value: no canary in message / detail / formatted text',
    (name) => {
      const url = `https://mcp.test/mcp?${name}=${CANARY}`
      const err = Object.assign(new Error(`MCP error -32602: Invalid signature ${CANARY}`), {
        name: 'ProtocolError',
        code: -32602,
      })
      const info = classifyTransportError(err, { protocol: 'mcp', transport: 'http', url })
      expect(JSON.stringify(info)).not.toContain(CANARY)
      expect(formatConnectionError(info)).not.toContain(CANARY)
    },
  )

  it('a plain-text 5xx body echoing the value is scrubbed as well', () => {
    const url = `https://mcp.test/mcp?sig=${CANARY}`
    const err = Object.assign(new Error(`HTTP 500: denied for sig=${CANARY} on /mcp`), {
      status: 500,
    })
    const info = classifyTransportError(err, { protocol: 'mcp', transport: 'http', url })
    expect(JSON.stringify(info)).not.toContain(CANARY)
  })

  it('control: a non-credential query value is left alone (the rule is not "blank every param")', () => {
    const url = `https://mcp.test/mcp?tenant=acme-eu`
    expect(scrubConnectionText('no such tenant acme-eu', url)).toContain('acme-eu')
  })
})

describe('P0-2: the same through the real MCP engine', () => {
  let server: Server | undefined
  afterEach(async () => {
    server?.closeAllConnections?.()
    await new Promise<void>((r) => (server ? server.close(() => r()) : r()))
    server = undefined
  })

  /** A Streamable HTTP endpoint that answers every JSON-RPC POST with an error. */
  async function rpcErrorServer(code: number, message: string): Promise<number> {
    server = createServer((req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(405).end()
        return
      }
      let raw = ''
      req.on('data', (c) => (raw += String(c)))
      req.on('end', () => {
        let id: unknown = null
        try {
          id = (JSON.parse(raw) as { id?: unknown }).id ?? null
        } catch {
          /* keep null */
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }))
      })
    })
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r))
    return (server.address() as net.AddressInfo).port
  }

  async function rejection(p: Promise<unknown>): Promise<Error> {
    try {
      await p
    } catch (e) {
      return e as Error
    }
    throw new Error('expected the connect to reject')
  }

  it('P0-2: server answers -32602 "Invalid signature SECRETCANARY" for ?sig=SECRETCANARY: not in the error', async () => {
    const port = await rpcErrorServer(-32602, `Invalid signature ${CANARY}`)
    const err = await rejection(
      mcpConnect({ transport: 'http', url: `http://127.0.0.1:${port}/mcp?sig=${CANARY}` }),
    )
    const text = JSON.stringify({
      message: err.message,
      info: getConnectionErrorInfo(err) ?? null,
    })
    expect(text).not.toContain(CANARY)
    // Not vacuous: the server's own answer is what the user sees.
    expect(err.message).toMatch(/Invalid signature/)
  })

  it('P1-3: server answers -32602 "Invalid URL in server configuration": its own message is kept, not re-classified as invalid-url', async () => {
    const port = await rpcErrorServer(-32602, 'Invalid URL in server configuration')
    const err = await rejection(
      mcpConnect({ transport: 'http', url: `http://127.0.0.1:${port}/mcp` }),
    )
    expect(err.message).toContain('Invalid URL in server configuration')
    // An answer the server gave in MCP terms is not a connection failure.
    expect(getConnectionErrorInfo(err)?.kind).not.toBe('invalid-url')
    expect(err.message).not.toMatch(/Check the URL/i)
  })
})

describe('P1-3: classifier level (the cause of the engine behaviour)', () => {
  it('control: a genuine malformed URL is still invalid-url', () => {
    const info = classifyTransportError(
      Object.assign(new TypeError('Invalid URL'), { code: 'ERR_INVALID_URL' }),
      { protocol: 'mcp', transport: 'http', url: 'not a url' },
    )
    expect(info.kind).toBe('invalid-url')
  })
})

// ─── P2-5: MQTT connack timeout ──────────────────────────────────

describe('P2-5: MQTT.js "connack timeout" is the standard timeout kind', () => {
  it('classifier: Error("connack timeout") on mqtt is kind timeout with the standard hint', () => {
    const info = classifyTransportError(new Error('connack timeout'), {
      protocol: 'mqtt',
      url: 'mqtt://broker.test:1883',
    })
    expect(info.kind).toBe('timeout')
    expect(info.target).toBe('broker.test:1883')
    expect(info.hint).toBeTruthy()
    const standard = classifyTransportError(Object.assign(new Error('x'), { code: 'ETIMEDOUT' }), {
      protocol: 'mqtt',
      url: 'mqtt://broker.test:1883',
    })
    expect(info.hint).toBe(standard.hint)
    expect(info.message).not.toMatch(/connack timeout/i)
  })

  it('engine: a broker that accepts TCP and never answers CONNACK rejects with kind timeout', async () => {
    const held = new Set<net.Socket>()
    const silent = net.createServer((sock) => {
      held.add(sock)
      sock.on('data', () => {}) // swallow the CONNECT, never reply
      sock.on('error', () => {})
    })
    await new Promise<void>((r) => silent.listen(0, '127.0.0.1', r))
    const port = (silent.address() as net.AddressInfo).port
    try {
      let err: Error | undefined
      try {
        await mqttConnect({
          url: `mqtt://127.0.0.1:${port}`,
          version: 4,
          settings: { connectionTimeout: 300 },
          onEvent: () => {},
        })
      } catch (e) {
        err = e as Error
      }
      expect(err, 'the connect must reject').toBeDefined()
      const info = getConnectionErrorInfo(err)
      expect(info?.kind).toBe('timeout')
      expect(info?.target).toBe(`127.0.0.1:${port}`)
      expect(info?.hint).toBeTruthy()
    } finally {
      for (const sock of held) sock.destroy()
      await new Promise<void>((r) => silent.close(() => r()))
    }
  }, 10_000)
})
