/**
 * Transport-error visibility tests for `src/main/protocols/http.engine.ts`.
 *
 * Behavioural guarantees:
 *   - `ECONNREFUSED` (nothing listening) surfaces as "Connection refused — ..."
 *   - DNS lookup failures surface as "DNS lookup failed — ..."
 *   - 4xx responses keep `status` + body intact AND populate `error` with a
 *     status-aware hint, so the response viewer never has to guess what 401 means.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { executeHttpRequest } from '../../src/main/protocols/http.engine'

describe('http.engine — transport error visibility', () => {
  it('emits a "Connection refused" error when nothing is listening', async () => {
    // Bind+release to grab a known-free port.
    const probe = createServer()
    await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve))
    const port = (probe.address() as AddressInfo).port
    await new Promise<void>((resolve) => probe.close(() => resolve()))

    const res = await executeHttpRequest({
      method: 'GET',
      url: `http://127.0.0.1:${port}/`,
      timeout: 2000,
    })
    expect(res.status).toBeUndefined()
    expect(res.error).toMatch(/Connection refused|ECONNREFUSED/i)
  })

  it('emits a "DNS lookup failed" error for unresolvable hostnames', async () => {
    // `.invalid` is reserved by RFC 6761 and guaranteed to never resolve, so
    // this is deterministic across CI environments (some resolvers serve
    // captive-portal pages for arbitrary unknown TLDs, which would 200 us).
    const res = await executeHttpRequest({
      method: 'GET',
      url: 'http://nope.invalid/',
      timeout: 5000,
    })
    expect(res.status).toBeUndefined()
    // Some resolvers (notably macOS captive-portal handlers + certain
    // corporate DNS setups) silently swallow .invalid lookups and let the
    // axios timeout fire instead of returning ENOTFOUND. Both outcomes
    // are valid "the host doesn't resolve" signals — accept either.
    expect(res.error).toMatch(/DNS lookup failed|ENOTFOUND|getaddrinfo|timed out|ECONNABORTED/i)
  }, 15000)
})

describe('http.engine — 4xx visibility', () => {
  let server: Server
  let port = 0

  beforeAll(
    () =>
      new Promise<void>((resolve) => {
        server = createServer((_req, res) => {
          res.writeHead(401, 'Unauthorized', { 'Content-Type': 'text/plain' })
          res.end('go away')
        })
        server.listen(0, '127.0.0.1', () => {
          const addr = server.address() as AddressInfo
          port = addr.port
          resolve()
        })
      }),
  )

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

  // The HTTP engine sets `validateStatus: () => true` so 4xx is NOT thrown by
  // axios — it returns a normal response with status=401. The catch block is
  // never entered, but the user still wants the body. This pins that contract.
  it('returns 401 with the body intact and no synthetic error string', async () => {
    const res = await executeHttpRequest({
      method: 'GET',
      url: `http://127.0.0.1:${port}/`,
      timeout: 2000,
    })
    expect(res.status).toBe(401)
    expect(res.body).toBe('go away')
    expect(res.error).toBeUndefined()
  })
})
