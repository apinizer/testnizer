/**
 * Cookie-jar scoping tests for `src/main/protocols/http.engine.ts` (issue #104).
 *
 * The engine keeps one tough-cookie jar PER PROJECT (`jarFor(projectId)`), with
 * a shared "_default" jar for callers that pass no projectId (Quick Test).
 * These tests drive the public `executeHttpRequest` path against a local
 * `http.createServer`:
 *
 *   - a login response's `Set-Cookie` must ride on the NEXT request of the
 *     SAME project (the issue-#104 user flow: login → authenticated call);
 *   - a DIFFERENT project must not see it (cookie isolation);
 *   - the no-project "_default" jar (Quick Test) must not see it either, and
 *     its own cookies must not leak into a project jar.
 *
 * The jar map is module-level engine state that persists for this test file's
 * lifetime, so project ids are randomUUID-unique per run and the tests below
 * are order-independent (each seeds its own login first when it needs one).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { randomUUID } from 'node:crypto'
import { executeHttpRequest } from '../../src/main/protocols/http.engine'

// ─── Local server: /login sets a cookie, everything else echoes it ──

let server: Server
let port = 0
/** Cookie header the server saw on the most recent non-login request. */
let lastCookieHeader: string | undefined

beforeAll(
  () =>
    new Promise<void>((resolve) => {
      server = createServer((req, res) => {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1')
        if (url.pathname === '/login') {
          // `name` lets each test mint its own cookie so the shared host
          // ("127.0.0.1") never causes cross-test bleed inside one jar.
          const name = url.searchParams.get('name') ?? 'SESSION'
          res.writeHead(200, {
            'Content-Type': 'application/json',
            // No `Secure` attribute — tough-cookie drops Secure cookies
            // arriving over plain http, which is what this server speaks.
            'Set-Cookie': `${name}=abc123; Path=/`,
          })
          res.end(JSON.stringify({ ok: true }))
          return
        }
        lastCookieHeader = req.headers.cookie
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ cookie: req.headers.cookie ?? null }))
      })
      server.listen(0, '127.0.0.1', () => {
        port = (server.address() as AddressInfo).port
        resolve()
      })
    }),
)

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

function baseUrl(path: string): string {
  return `http://127.0.0.1:${port}${path}`
}

async function login(cookieName: string, projectId?: string): Promise<void> {
  const res = await executeHttpRequest({
    method: 'GET',
    url: baseUrl(`/login?name=${cookieName}`),
    timeout: 3000,
    projectId,
  })
  expect(res.status).toBe(200)
}

/** GET /whoami under the given jar scope; returns the Cookie header seen on the wire. */
async function whoami(projectId?: string): Promise<string | undefined> {
  lastCookieHeader = undefined
  const res = await executeHttpRequest({
    method: 'GET',
    url: baseUrl('/whoami'),
    timeout: 3000,
    projectId,
  })
  expect(res.status).toBe(200)
  return lastCookieHeader
}

// ─── Tests ───────────────────────────────────────────────────

describe('http.engine cookie jar — per-project scoping (issue #104)', () => {
  it('sends a stored Set-Cookie on the next request of the SAME project', async () => {
    const projectA = `projA-${randomUUID()}`
    await login('SESSION_SAME', projectA)
    const cookie = await whoami(projectA)
    expect(cookie).toContain('SESSION_SAME=abc123')
  })

  it('does NOT leak the cookie into a DIFFERENT project jar', async () => {
    const projectA = `projA-${randomUUID()}`
    const projectB = `projB-${randomUUID()}`
    await login('SESSION_ISOLATED', projectA)
    const cookie = await whoami(projectB)
    expect(cookie ?? '').not.toContain('SESSION_ISOLATED')
  })

  it('does NOT leak a project cookie into the no-project "_default" (Quick Test) jar', async () => {
    const projectA = `projA-${randomUUID()}`
    await login('SESSION_PROJ_ONLY', projectA)
    const cookie = await whoami(undefined)
    expect(cookie ?? '').not.toContain('SESSION_PROJ_ONLY')
  })

  it('keeps a no-project login in "_default": visible there, invisible to project jars', async () => {
    const projectC = `projC-${randomUUID()}`
    await login('SESSION_DEFAULT', undefined)
    // The _default jar itself sees it…
    const defaultCookie = await whoami(undefined)
    expect(defaultCookie).toContain('SESSION_DEFAULT=abc123')
    // …but a project jar does not.
    const projectCookie = await whoami(projectC)
    expect(projectCookie ?? '').not.toContain('SESSION_DEFAULT')
  })
})
