import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'node:http'
import { forwardRequest, buildEchoResponse } from '../../src/main/mock/proxy'

let upstreamServer: http.Server
let upstreamPort = 0

beforeAll(async () => {
  upstreamServer = http.createServer((req, res) => {
    if (req.url?.startsWith('/echo')) {
      const chunks: Buffer[] = []
      req.on('data', (c: Buffer) => chunks.push(c))
      req.on('end', () => {
        res.statusCode = 200
        res.setHeader('content-type', 'application/json')
        res.setHeader('x-upstream', 'yes')
        res.end(
          JSON.stringify({
            method: req.method,
            url: req.url,
            xfoo: req.headers['x-foo'] ?? null,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        )
      })
      return
    }
    if (req.url === '/error') {
      res.destroy()
      return
    }
    res.statusCode = 404
    res.end('not found')
  })
  await new Promise<void>((resolve) => {
    upstreamServer.listen(0, '127.0.0.1', () => resolve())
  })
  const addr = upstreamServer.address()
  if (addr && typeof addr === 'object') upstreamPort = addr.port
})

afterAll(async () => {
  await new Promise<void>((resolve) => upstreamServer.close(() => resolve()))
})

describe('forwardRequest', () => {
  it('forwards method, body and arbitrary headers', async () => {
    const r = await forwardRequest({
      target: `http://127.0.0.1:${upstreamPort}`,
      method: 'POST',
      pathWithQuery: '/echo?x=1',
      headers: { 'x-foo': 'bar', 'content-type': 'text/plain' },
      body: 'hello',
    })
    expect(r.status).toBe(200)
    expect(r.headers['x-upstream']).toBe('yes')
    const body = JSON.parse(r.body) as { method: string; url: string; xfoo: string; body: string }
    expect(body.method).toBe('POST')
    expect(body.url).toBe('/echo?x=1')
    expect(body.xfoo).toBe('bar')
    expect(body.body).toBe('hello')
  })

  it('strips hop-by-hop headers (host, connection)', async () => {
    const r = await forwardRequest({
      target: `http://127.0.0.1:${upstreamPort}`,
      method: 'GET',
      pathWithQuery: '/echo',
      headers: { host: 'attacker.example', connection: 'keep-alive', 'x-foo': 'bar' },
      body: '',
    })
    expect(r.status).toBe(200)
    // The upstream sees its own host, not "attacker.example".
    const body = JSON.parse(r.body) as { xfoo: string }
    expect(body.xfoo).toBe('bar')
  })

  it('returns 502 on connection error', async () => {
    const r = await forwardRequest({
      target: 'http://127.0.0.1:1', // closed port
      method: 'GET',
      pathWithQuery: '/',
      headers: {},
      body: '',
    })
    expect(r.status).toBe(502)
    expect(JSON.parse(r.body).error).toBe('bad_gateway')
  })

  it('returns 502 on invalid target', async () => {
    const r = await forwardRequest({
      target: 'not a url',
      method: 'GET',
      pathWithQuery: '/',
      headers: {},
      body: '',
    })
    expect(r.status).toBe(502)
  })

  it('returns 502 when upstream destroys the socket', async () => {
    const r = await forwardRequest({
      target: `http://127.0.0.1:${upstreamPort}`,
      method: 'GET',
      pathWithQuery: '/error',
      headers: {},
      body: '',
    })
    expect(r.status).toBe(502)
  })
})

describe('buildEchoResponse', () => {
  it('returns the request as JSON', () => {
    const r = buildEchoResponse({
      method: 'POST',
      path: '/__echo',
      headers: { 'x-trace': 'abc' },
      query: { q: '1' },
      body: { name: 'Alice' },
      bodyText: '{"name":"Alice"}',
    })
    expect(r.status).toBe(200)
    expect(r.headers['content-type']).toMatch(/application\/json/)
    const parsed = JSON.parse(r.body) as Record<string, unknown>
    expect(parsed.method).toBe('POST')
    expect(parsed.path).toBe('/__echo')
    expect(parsed.headers).toEqual({ 'x-trace': 'abc' })
    expect(parsed.query).toEqual({ q: '1' })
    expect(parsed.body).toEqual({ name: 'Alice' })
  })
})
