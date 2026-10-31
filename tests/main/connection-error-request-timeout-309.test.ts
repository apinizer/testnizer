/**
 * Issue #309 — the shared `timeout` hint said "raise the connect timeout in
 * Settings" for an HTTP / GraphQL / SOAP send too, where it is a REQUEST
 * timeout set in the request's Settings tab, the project settings or app
 * Settings. The realtime connects (WebSocket, Socket.IO, SSE, MCP, MQTT) keep
 * the "connect timeout" wording.
 *
 * CONTRACT: one formatter. The distinction comes from data that already
 * exists — the classifier's `protocol` context in main, the response's
 * `protocol` in the renderer — through the shared table
 * (`CONNECTION_ERROR_TEXT_EN.timeout.requestHint`, i18n
 * `connError.timeout.requestHint`). The engines pass their protocol.
 */
import { describe, expect, it, afterAll, beforeAll } from 'vitest'
import { createServer, type Server, type Socket } from 'node:net'
import type { AddressInfo } from 'node:net'
import { classifyTransportError, formatConnectionError } from '../../src/main/lib/error-classifier'
import { connectionErrorEnglishKeys } from '../../src/shared/connection-error'
import { executeHttpRequest } from '../../src/main/protocols/http.engine'
import { executeQuery } from '../../src/main/protocols/graphql.engine'
import { executeSoap } from '../../src/main/protocols/soap.engine'

function timedOut(): Error {
  return Object.assign(new Error('connect ETIMEDOUT 10.0.0.1:443'), { code: 'ETIMEDOUT' })
}

describe('classifier: request vs connect timeout hint', () => {
  it.each(['http', 'graphql', 'soap'] as const)('%s → "request timeout"', (protocol) => {
    const info = classifyTransportError(timedOut(), { protocol })
    expect(info.kind).toBe('timeout')
    expect(info.hint).toMatch(/request timeout/)
    expect(info.hint).not.toMatch(/connect timeout/)
    expect(info.hint).toMatch(/request Settings tab/)
    expect(info.hint).toMatch(/project settings/)
    expect(formatConnectionError(info)).toMatch(/request timeout/)
  })

  it.each(['websocket', 'socketio', 'sse', 'mcp', 'mqtt'] as const)(
    '%s → keeps "connect timeout"',
    (protocol) => {
      const info = classifyTransportError(timedOut(), { protocol })
      expect(info.kind).toBe('timeout')
      expect(info.hint).toMatch(/connect timeout/)
      expect(info.hint).not.toMatch(/request timeout/)
    },
  )

  it('no protocol context → the connect wording (unchanged default)', () => {
    expect(classifyTransportError(timedOut()).hint).toMatch(/connect timeout/)
  })

  it('the request hint is part of the EN key table the renderer mirrors', () => {
    const keys = connectionErrorEnglishKeys()
    expect(keys['connError.timeout.requestHint']).toMatch(/request timeout/)
    expect(keys['connError.timeout.hint']).toMatch(/connect timeout/)
  })
})

describe('engines pass their protocol (a silent server times the send out)', () => {
  let server: Server
  let base: string
  const sockets: Socket[] = []

  beforeAll(async () => {
    // Accepts the TCP connection, never answers → axios "timeout of Nms exceeded".
    server = createServer((s) => {
      sockets.push(s)
      s.on('error', () => {})
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    for (const s of sockets) s.destroy()
    await new Promise<void>((r) => server.close(() => r()))
  })

  it('HTTP', async () => {
    const res = await executeHttpRequest({ method: 'GET', url: `${base}/`, timeout: 150 })
    expect(res.errorInfo?.kind).toBe('timeout')
    expect(res.error).toMatch(/request timeout/)
    expect(res.errorInfo?.hint).toMatch(/request timeout/)
  })

  it('GraphQL', async () => {
    const res = await executeQuery({ url: `${base}/graphql`, query: '{ a }', timeout: 150 })
    expect(res.errorInfo?.kind).toBe('timeout')
    expect(res.error).toMatch(/request timeout/)
  })

  it('SOAP', async () => {
    const res = await executeSoap({
      wsdlUrl: '',
      endpointUrl: `${base}/soap`,
      operationName: 'Ping',
      soapVersion: 'soap11',
      params: {},
      timeout: 150,
    })
    expect(res.errorInfo?.kind).toBe('timeout')
    expect(res.error).toMatch(/request timeout/)
  })
})
