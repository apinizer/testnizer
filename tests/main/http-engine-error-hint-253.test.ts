/**
 * 1.6.0 screen review G-04 (issue #253) — the HTTP response error for a
 * refused connection showed what happened + host:port but no next step, while
 * the WebSocket editor said "Check that the server is running". Both now go
 * through the ONE connection-error format (`formatConnectionError`), and the
 * HTTP / GraphQL response carries the classified `errorInfo` so the renderer
 * can write it in the active locale.
 */
import { describe, expect, it } from 'vitest'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { executeHttpRequest } from '../../src/main/protocols/http.engine'
import { executeQuery } from '../../src/main/protocols/graphql.engine'

async function freePort(): Promise<number> {
  const probe = createServer()
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve))
  const port = (probe.address() as AddressInfo).port
  await new Promise<void>((resolve) => probe.close(() => resolve()))
  return port
}

describe('HTTP / GraphQL connection errors carry the next step (G-04)', () => {
  it('HTTP: refused → "Connection refused — host:port. Check that the server is running"', async () => {
    const port = await freePort()
    const res = (await executeHttpRequest({
      method: 'GET',
      url: `http://127.0.0.1:${port}/`,
      timeout: 2000,
    })) as { status?: number; error?: string; errorInfo?: { kind: string; target?: string } }
    expect(res.status).toBeUndefined()
    expect(res.error).toBe(
      `Connection refused — 127.0.0.1:${port}. Check that the server is running`,
    )
    expect(res.errorInfo?.kind).toBe('refused')
    expect(res.errorInfo?.target).toBe(`127.0.0.1:${port}`)
  })

  it('guard: a non-connection failure keeps its own text (no "Connection failed — host" prefix)', async () => {
    const server = createServer((req, res) => {
      const n = Number((req.url ?? '').split('/').pop())
      res.writeHead(302, { Location: `/r/${n - 1}` })
      res.end()
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    try {
      const res = await executeHttpRequest({
        method: 'GET',
        url: `http://127.0.0.1:${port}/r/5`,
        followRedirects: true,
        maxRedirects: 2,
        timeout: 2000,
      })
      expect(res.error).toMatch(/redirect/i)
      expect(res.error).not.toMatch(/^Connection failed/)
      expect(res.error).not.toContain(`127.0.0.1:${port}`)
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('GraphQL: the same composition', async () => {
    const port = await freePort()
    const res = (await executeQuery({
      url: `http://127.0.0.1:${port}/graphql`,
      query: '{ __typename }',
      timeout: 2000,
    })) as { error?: string; errorInfo?: { kind: string } }
    expect(res.error).toBe(
      `Connection refused — 127.0.0.1:${port}. Check that the server is running`,
    )
    expect(res.errorInfo?.kind).toBe('refused')
  })
})
