import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer, type Server } from 'http'
import { executeHttpRequest } from '../../src/main/protocols/http.engine'
import { executeSoap } from '../../src/main/protocols/soap.engine'
import {
  applyDefaultUserAgent,
  getDefaultUserAgent,
} from '../../src/main/lib/user-agent'

interface Captured {
  headers: Record<string, string | string[] | undefined>
  body: string
}

let server: Server
let port = 0
let captured: Captured | null = null

beforeAll(
  () =>
    new Promise<void>((resolve) => {
      server = createServer((req, res) => {
        const chunks: Buffer[] = []
        req.on('data', (c: Buffer) => chunks.push(c))
        req.on('end', () => {
          captured = { headers: req.headers, body: Buffer.concat(chunks).toString('utf8') }
          res.writeHead(200, { 'Content-Type': 'text/plain' })
          res.end('ok')
        })
      })
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address()
        if (addr && typeof addr === 'object') port = addr.port
        resolve()
      })
    }),
)

afterAll(
  () =>
    new Promise<void>((resolve) => {
      server.close(() => resolve())
    }),
)

describe('default User-Agent — http engine', () => {
  it('adds Testnizer/<version> when caller supplies no User-Agent', async () => {
    captured = null
    const result = await executeHttpRequest({
      method: 'GET',
      url: `http://127.0.0.1:${port}/`,
    })
    expect(result.status).toBe(200)
    expect(captured!.headers['user-agent']).toBe(getDefaultUserAgent())
    expect(String(captured!.headers['user-agent'])).toMatch(/^Testnizer\/.+/)
  })

  it('respects a user-supplied User-Agent header (case-insensitive)', async () => {
    captured = null
    await executeHttpRequest({
      method: 'GET',
      url: `http://127.0.0.1:${port}/`,
      headers: [
        { id: '1', key: 'user-agent', value: 'MyClient/9.9', enabled: true },
      ],
    })
    expect(captured!.headers['user-agent']).toBe('MyClient/9.9')
  })

  it('respects a user-supplied User-Agent with mixed case', async () => {
    captured = null
    await executeHttpRequest({
      method: 'GET',
      url: `http://127.0.0.1:${port}/`,
      headers: [
        { id: '1', key: 'User-Agent', value: 'MixedCase/1.0', enabled: true },
      ],
    })
    expect(captured!.headers['user-agent']).toBe('MixedCase/1.0')
  })
})

describe('default User-Agent — soap engine', () => {
  it('adds default UA when caller passes no headers', async () => {
    captured = null
    const result = await executeSoap({
      wsdlUrl: '',
      endpointUrl: `http://127.0.0.1:${port}/svc`,
      operationName: 'Ping',
      soapVersion: 'soap11',
      params: {},
    })
    expect(result.status).toBe(200)
    expect(captured!.headers['user-agent']).toBe(getDefaultUserAgent())
  })

  it('respects a user-supplied UA in headers map (any case)', async () => {
    captured = null
    await executeSoap({
      wsdlUrl: '',
      endpointUrl: `http://127.0.0.1:${port}/svc`,
      operationName: 'Ping',
      soapVersion: 'soap11',
      params: {},
      headers: { 'USER-AGENT': 'SoapyClient/2.0' },
    })
    expect(captured!.headers['user-agent']).toBe('SoapyClient/2.0')
  })
})

describe('applyDefaultUserAgent helper', () => {
  it('does not overwrite when any-case UA is already present', () => {
    const a = applyDefaultUserAgent({ 'user-agent': 'X' })
    expect(a['user-agent']).toBe('X')
    expect(a['User-Agent']).toBeUndefined()

    const b = applyDefaultUserAgent({ 'USER-AGENT': 'Y' })
    expect(b['USER-AGENT']).toBe('Y')
    expect(b['User-Agent']).toBeUndefined()
  })

  it('inserts default UA on empty header map', () => {
    const h = applyDefaultUserAgent({})
    expect(h['User-Agent']).toBe(getDefaultUserAgent())
  })
})
