/**
 * Issue #295 — a client secret the user typed is not sent to an
 * authorization server the MCP server advertised on ANOTHER host until the
 * user confirms that host (GHSA-6qxp-vccf-f47h: the SDK's fix does not cover
 * direct `exchangeAuthorization` / `refreshAuthorization` calls).
 *
 * Fixture: a minimal MCP resource server on `127.0.0.1` (401 + RFC 9728
 * document naming a mutable authorization server) and a fake authorization
 * server that records EVERY request it gets. The AS is advertised under a
 * name that is not `127.0.0.1` — `localhost` (loopback, so the SDK's
 * `exchangeAuthorization` path runs) or `auth.intranet.test` (non-loopback,
 * the #170 plain-HTTP path) — and a stubbed `fetch` resolves those names to
 * the fake's listener. Same-host fixtures advertise `127.0.0.1` itself.
 */
import http from 'node:http'
import { createHash, randomUUID } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createMcpOAuthFetch,
  mcpOAuthCancel,
  mcpOAuthConfirm,
  mcpOAuthForget,
  mcpOAuthHasToken,
  mcpOAuthStart,
  secretGateOf,
  type McpOAuthDone,
  type McpOAuthStartOptions,
  type McpOAuthStep,
} from '../../src/main/protocols/mcp-oauth.engine'

const SECRET = 'typed-secret-295-0123456789'
const CLIENT_ID = 'manual-295'
const GOOD_TOKEN = 'at-GOOD-295-0123456789abcdef'
const STALE_TOKEN = 'at-STALE-295-0123456789abcdef'
const REFRESH_TOKEN = 'rt-295-0123456789abcdef-refresh'
const ADDRESSED = 'x-test-addressed-host'
const NAMES = new Set(['localhost', 'auth.intranet.test', 'other.intranet.test'])

// ─── Name resolution ────────────────────────────────────────

const realFetch = globalThis.fetch

/** Sends the test names to 127.0.0.1 (same port); the addressed host travels in a header. */
const namedFetch: typeof fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input))
  if (!NAMES.has(url.hostname)) return realFetch(input, init)
  const host = url.host
  url.hostname = '127.0.0.1'
  const headers = new Headers(init?.headers)
  headers.set(ADDRESSED, host)
  return realFetch(url, { ...init, headers })
}

// ─── Fake authorization server ──────────────────────────────

interface AsRequest {
  method: string
  path: string
  host: string
  body: string
  authorization?: string
}

interface FakeAs {
  port: number
  /** The advertised issuer (`http://<name>:<port>`). */
  issuer: string
  requests: AsRequest[]
  close: () => Promise<void>
}

interface AsOptions {
  /** Name the issuer is advertised under. */
  name: string
  /** Name the metadata gives the token endpoint (default: `name`). */
  tokenName?: string
  authMethods?: string[]
  withRefresh?: boolean
  firstToken?: string
}

async function startFakeAs(opts: AsOptions): Promise<FakeAs> {
  const codes = new Map<string, string>()
  const fake: FakeAs = { port: 0, issuer: '', requests: [], close: async () => {} }
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const json = (status: number, body: unknown): void => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    let raw = ''
    req.on('data', (c: Buffer) => (raw += c.toString('utf8')))
    req.on('end', () => {
      fake.requests.push({
        method: req.method ?? '',
        path: url.pathname,
        host: String(req.headers[ADDRESSED] ?? req.headers.host ?? ''),
        body: raw,
        ...(req.headers.authorization ? { authorization: req.headers.authorization } : {}),
      })
      if (req.method === 'GET' && url.pathname === '/.well-known/oauth-authorization-server') {
        json(200, {
          issuer: fake.issuer,
          authorization_endpoint: `${fake.issuer}/authorize`,
          token_endpoint: `http://${opts.tokenName ?? opts.name}:${fake.port}/token`,
          registration_endpoint: `${fake.issuer}/register`,
          response_types_supported: ['code'],
          grant_types_supported: ['authorization_code', 'refresh_token'],
          code_challenge_methods_supported: ['S256'],
          token_endpoint_auth_methods_supported: opts.authMethods ?? ['client_secret_post'],
        })
        return
      }
      if (req.method === 'POST' && url.pathname === '/register') {
        const body = JSON.parse(raw) as Record<string, unknown>
        json(201, { ...body, client_id: 'dcr-client-295', client_id_issued_at: 1 })
        return
      }
      if (req.method === 'GET' && url.pathname === '/authorize') {
        const code = `code-${randomUUID()}`
        codes.set(code, url.searchParams.get('code_challenge') ?? '')
        const back = new URL(url.searchParams.get('redirect_uri') ?? '')
        back.searchParams.set('code', code)
        back.searchParams.set('state', url.searchParams.get('state') ?? '')
        back.searchParams.set('iss', fake.issuer)
        res.writeHead(302, { Location: back.href })
        res.end()
        return
      }
      if (req.method === 'POST' && url.pathname === '/token') {
        const params = new URLSearchParams(raw)
        if (params.get('grant_type') === 'refresh_token') {
          if (params.get('refresh_token') !== REFRESH_TOKEN) {
            json(400, { error: 'invalid_grant' })
            return
          }
          json(200, { access_token: GOOD_TOKEN, token_type: 'Bearer', expires_in: 3600 })
          return
        }
        const challenge = codes.get(params.get('code') ?? '')
        const verifier = params.get('code_verifier') ?? ''
        if (challenge !== createHash('sha256').update(verifier).digest('base64url')) {
          json(400, { error: 'invalid_grant' })
          return
        }
        json(200, {
          access_token: opts.firstToken ?? GOOD_TOKEN,
          token_type: 'Bearer',
          expires_in: 3600,
          ...(opts.withRefresh ? { refresh_token: REFRESH_TOKEN } : {}),
        })
        return
      }
      json(404, { error: 'not_found' })
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  fake.port = (server.address() as AddressInfo).port
  fake.issuer = `http://${opts.name}:${fake.port}`
  fake.close = () =>
    new Promise<void>((resolve) => {
      server.close(() => resolve())
      server.closeAllConnections()
    })
  return fake
}

/** Every request that carried the typed secret (form field or Basic credentials). */
function secretBearing(fake: FakeAs): AsRequest[] {
  const basic = Buffer.from(`${CLIENT_ID}:${SECRET}`).toString('base64')
  return fake.requests.filter(
    (r) =>
      r.body.includes(SECRET) ||
      r.body.includes(encodeURIComponent(SECRET)) ||
      (r.authorization ?? '').includes(basic),
  )
}

const tokenPosts = (fake: FakeAs, grant: string): AsRequest[] =>
  fake.requests.filter(
    (r) => r.path === '/token' && new URLSearchParams(r.body).get('grant_type') === grant,
  )

// ─── Minimal MCP resource server (RFC 9728) ─────────────────

interface FakeMcp {
  url: string
  /** The authorization server the RFC 9728 document names — mutable between flows. */
  asUrl: string
  close: () => Promise<void>
}

async function startFakeMcp(asUrl: string): Promise<FakeMcp> {
  const fake: FakeMcp = { url: '', asUrl, close: async () => {} }
  const server = http.createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0]
    req.resume()
    if (path === '/.well-known/oauth-protected-resource/mcp') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ resource: fake.url, authorization_servers: [fake.asUrl] }))
      return
    }
    const origin = new URL(fake.url).origin
    res.writeHead(401, {
      'WWW-Authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`,
    })
    res.end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  fake.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`
  fake.close = () =>
    new Promise<void>((resolve) => {
      server.close(() => resolve())
      server.closeAllConnections()
    })
  return fake
}

// ─── Flow driver ────────────────────────────────────────────

type Answer = 'accept' | 'reject' | 'cancel' | 'none'

interface Run {
  id: string
  done: McpOAuthDone
  events: McpOAuthStep[]
  /** The step events that carried a question. */
  asked: McpOAuthStep[]
  /** Secret-bearing AS requests seen at the moment of each question. */
  secretRequestsWhenAsked: number[]
  /** Browser opens seen at the moment of each question. */
  browserOpensWhenAsked: number[]
  browserOpens: number
}

async function runFlow(
  options: McpOAuthStartOptions,
  fakeAs: FakeAs,
  answer: Answer,
  callbackTimeoutMs = 5_000,
): Promise<Run> {
  const run: Run = {
    id: '',
    done: { oauthSessionId: '', ok: false },
    events: [],
    asked: [],
    secretRequestsWhenAsked: [],
    browserOpensWhenAsked: [],
    browserOpens: 0,
  }
  const { oauthSessionId, finished } = mcpOAuthStart(options, {
    openUrl: async (url) => {
      run.browserOpens += 1
      await (await fetch(url)).text()
    },
    callbackTimeoutMs,
    onStep: (id, step) => {
      run.events.push(step)
      if (!step.confirmation) return
      run.asked.push(step)
      run.secretRequestsWhenAsked.push(secretBearing(fakeAs).length)
      run.browserOpensWhenAsked.push(run.browserOpens)
      // The renderer answers asynchronously — so does the test.
      setTimeout(() => {
        if (answer === 'accept') mcpOAuthConfirm(id, true)
        else if (answer === 'reject') mcpOAuthConfirm(id, false)
        else if (answer === 'cancel') mcpOAuthCancel(id)
      }, 20)
    },
  })
  run.id = oauthSessionId
  startedIds.push(oauthSessionId)
  run.done = await finished
  return run
}

const stepOf = (run: Run, id: McpOAuthStep['id']): McpOAuthStep | undefined =>
  [...run.events].reverse().find((s) => s.id === id)

/** A resource-server stand-in: 401 for any token but GOOD_TOKEN. */
function resourceFetch(seen: string[]): typeof fetch {
  return async (_input, init) => {
    const auth = new Headers(init?.headers).get('authorization') ?? ''
    seen.push(auth)
    return new Response('{}', { status: auth === `Bearer ${GOOD_TOKEN}` ? 200 : 401 })
  }
}

const startedIds: string[] = []
const closers: Array<() => Promise<void>> = []

async function setup(as: AsOptions): Promise<{ fakeAs: FakeAs; mcp: FakeMcp }> {
  const fakeAs = await startFakeAs(as)
  const mcp = await startFakeMcp(fakeAs.issuer)
  closers.push(fakeAs.close, mcp.close)
  return { fakeAs, mcp }
}

const manual = (url: string, extra: Partial<McpOAuthStartOptions> = {}): McpOAuthStartOptions => ({
  url,
  clientId: CLIENT_ID,
  clientSecret: SECRET,
  ...extra,
})

beforeEach(() => {
  vi.stubGlobal('fetch', namedFetch)
})

afterEach(async () => {
  vi.unstubAllGlobals()
  for (const id of startedIds.splice(0)) mcpOAuthForget(id)
  for (const close of closers.splice(0)) await close()
})

// ─── SDK path (`exchangeAuthorization`) ─────────────────────

describe('issue #295 — client secret to an advertised authorization server on another host', () => {
  it('asks before the browser opens, sends no secret before the answer, sends it after confirm', async () => {
    const { fakeAs, mcp } = await setup({ name: 'localhost' })
    const run = await runFlow(manual(mcp.url), fakeAs, 'accept')

    expect(run.asked).toHaveLength(1)
    const asked = run.asked[0]
    expect(asked.id).toBe('client-registration')
    expect(asked.status).toBe('running')
    expect(asked.confirmation).toEqual({
      mcpServer: new URL(mcp.url).origin,
      authorizationServer: fakeAs.issuer,
      tokenEndpoint: fakeAs.issuer,
    })
    // Nothing secret-bearing reached the AS, and the browser was not opened, yet.
    expect(run.secretRequestsWhenAsked).toEqual([0])
    expect(run.browserOpensWhenAsked).toEqual([0])

    expect(run.done.ok).toBe(true)
    const exchange = tokenPosts(fakeAs, 'authorization_code')
    expect(exchange).toHaveLength(1)
    expect(new URLSearchParams(exchange[0].body).get('client_secret')).toBe(SECRET)
    expect(exchange[0].host).toBe(`localhost:${fakeAs.port}`)
    const step4 = stepOf(run, 'client-registration')
    expect(step4?.status).toBe('skipped')
    expect(step4?.confirmation).toBeUndefined()
    expect(step4?.note).toContain(`You confirmed sending the client secret to ${fakeAs.issuer}`)
    // The question carries origins only — never the secret.
    expect(JSON.stringify(run.events)).not.toContain(SECRET)
  })

  it('Cancel on the question stops the flow with a clear step error — no secret, no browser', async () => {
    const { fakeAs, mcp } = await setup({ name: 'localhost' })
    const run = await runFlow(manual(mcp.url), fakeAs, 'reject')

    expect(run.asked).toHaveLength(1)
    expect(run.done.ok).toBe(false)
    expect(run.done.failedStep).toBe('client-registration')
    expect(run.done.error).toMatch(/Not confirmed — the client secret was not sent to/)
    expect(run.done.error).toContain(fakeAs.issuer)
    expect(stepOf(run, 'client-registration')?.status).toBe('failed')
    expect(stepOf(run, 'token-exchange')?.status).toBe('skipped')
    expect(secretBearing(fakeAs)).toHaveLength(0)
    expect(tokenPosts(fakeAs, 'authorization_code')).toHaveLength(0)
    expect(run.browserOpens).toBe(0)
    expect(mcpOAuthHasToken(run.id)).toBe(false)
  })

  it('the flow Cancel while asking releases the wait (cancelled, nothing sent)', async () => {
    const { fakeAs, mcp } = await setup({ name: 'localhost' })
    const run = await runFlow(manual(mcp.url), fakeAs, 'cancel')

    expect(run.asked).toHaveLength(1)
    expect(run.done).toMatchObject({ ok: false, cancelled: true })
    expect(secretBearing(fakeAs)).toHaveLength(0)
  })

  it('an unanswered question times out — the flow never hangs and nothing is sent', async () => {
    const { fakeAs, mcp } = await setup({ name: 'localhost' })
    const run = await runFlow(manual(mcp.url), fakeAs, 'none', 300)

    expect(run.done.ok).toBe(false)
    expect(run.done.failedStep).toBe('client-registration')
    expect(run.done.error).toMatch(/waiting for you to confirm the authorization server/)
    expect(secretBearing(fakeAs)).toHaveLength(0)
  })

  it('the answer is remembered for the same server + authorization server; another host asks again', async () => {
    const { fakeAs, mcp } = await setup({ name: 'localhost' })
    const first = await runFlow(manual(mcp.url), fakeAs, 'accept')
    expect(first.asked).toHaveLength(1)
    expect(first.done.ok).toBe(true)

    const second = await runFlow(manual(mcp.url), fakeAs, 'none')
    expect(second.asked).toHaveLength(0)
    expect(second.done.ok).toBe(true)
    expect(stepOf(second, 'client-registration')?.note).toMatch(/already confirmed/)
    expect(tokenPosts(fakeAs, 'authorization_code')).toHaveLength(2)

    // Same MCP server, now naming an authorization server under another host
    // (the intranet name, reached over the #170 opt-in): asked again.
    const otherAs = await startFakeAs({ name: 'auth.intranet.test' })
    closers.push(otherAs.close)
    mcp.asUrl = otherAs.issuer
    const third = await runFlow(manual(mcp.url, { allowHttpAuthServer: true }), otherAs, 'reject')
    expect(third.asked).toHaveLength(1)
    expect(third.asked[0].confirmation?.authorizationServer).toBe(otherAs.issuer)
    expect(third.done.ok).toBe(false)
    expect(secretBearing(otherAs)).toHaveLength(0)
  })

  it('a token endpoint on another host than a same-host authorization server is asked about too', async () => {
    // The AS shares the MCP server's host, but its metadata sends the token
    // request (and so the secret) to a third host.
    const { fakeAs, mcp } = await setup({ name: '127.0.0.1', tokenName: 'localhost' })
    const run = await runFlow(manual(mcp.url), fakeAs, 'reject')

    expect(run.asked).toHaveLength(1)
    expect(run.asked[0].confirmation).toEqual({
      mcpServer: new URL(mcp.url).origin,
      authorizationServer: fakeAs.issuer,
      tokenEndpoint: `http://localhost:${fakeAs.port}`,
    })
    expect(secretBearing(fakeAs)).toHaveLength(0)
  })

  it('refresh after confirm sends the secret again without asking', async () => {
    const { fakeAs, mcp } = await setup({
      name: 'localhost',
      withRefresh: true,
      firstToken: STALE_TOKEN,
    })
    const run = await runFlow(manual(mcp.url), fakeAs, 'accept')
    expect(run.done.ok).toBe(true)
    const askedBefore = run.asked.length

    const seen: string[] = []
    const res = await createMcpOAuthFetch(run.id, resourceFetch(seen))(mcp.url, { method: 'POST' })
    expect(res.status).toBe(200)
    expect(seen).toEqual([`Bearer ${STALE_TOKEN}`, `Bearer ${GOOD_TOKEN}`])
    const refresh = tokenPosts(fakeAs, 'refresh_token')
    expect(refresh).toHaveLength(1)
    expect(new URLSearchParams(refresh[0].body).get('client_secret')).toBe(SECRET)
    expect(run.asked.length).toBe(askedBefore)
  })
})

// ─── Plain-HTTP path (#170 opt-in, non-loopback host) ───────

describe('issue #295 — plain-HTTP intranet authorization server (issue #170 path)', () => {
  it('client_secret_basic: no Basic credentials reach auth.intranet.test before confirm; after confirm they do', async () => {
    const { fakeAs, mcp } = await setup({
      name: 'auth.intranet.test',
      authMethods: ['client_secret_basic'],
    })
    const run = await runFlow(manual(mcp.url, { allowHttpAuthServer: true }), fakeAs, 'accept')

    expect(run.asked).toHaveLength(1)
    expect(run.asked[0].confirmation?.authorizationServer).toBe(fakeAs.issuer)
    expect(run.secretRequestsWhenAsked).toEqual([0])
    expect(run.done.ok).toBe(true)
    const exchange = tokenPosts(fakeAs, 'authorization_code')
    expect(exchange).toHaveLength(1)
    expect(exchange[0].host).toBe(`auth.intranet.test:${fakeAs.port}`)
    expect(exchange[0].authorization).toBe(
      `Basic ${Buffer.from(`${CLIENT_ID}:${SECRET}`).toString('base64')}`,
    )
  })

  it('Cancel: nothing secret-bearing ever reaches the intranet authorization server', async () => {
    const { fakeAs, mcp } = await setup({ name: 'auth.intranet.test' })
    const run = await runFlow(manual(mcp.url, { allowHttpAuthServer: true }), fakeAs, 'reject')

    expect(run.done.ok).toBe(false)
    expect(run.done.failedStep).toBe('client-registration')
    expect(secretBearing(fakeAs)).toHaveLength(0)
    expect(fakeAs.requests.filter((r) => r.path === '/token')).toHaveLength(0)
  })
})

// ─── Unchanged flows ────────────────────────────────────────

describe('issue #295 — flows that never ask', () => {
  it('same-host authorization server (other port): the secret is sent without a question', async () => {
    const { fakeAs, mcp } = await setup({ name: '127.0.0.1' })
    const run = await runFlow(manual(mcp.url), fakeAs, 'none')

    expect(run.asked).toHaveLength(0)
    expect(run.done.ok).toBe(true)
    expect(
      new URLSearchParams(tokenPosts(fakeAs, 'authorization_code')[0].body).get('client_secret'),
    ).toBe(SECRET)
  })

  it('a public manual client (no secret) on another host: no question', async () => {
    const { fakeAs, mcp } = await setup({ name: 'localhost', authMethods: ['none'] })
    const run = await runFlow({ url: mcp.url, clientId: CLIENT_ID }, fakeAs, 'none')

    expect(run.asked).toHaveLength(0)
    expect(run.done.ok).toBe(true)
  })

  it('dynamic client registration on another host: no question', async () => {
    const { fakeAs, mcp } = await setup({ name: 'localhost', authMethods: ['none'] })
    const run = await runFlow({ url: mcp.url }, fakeAs, 'none')

    expect(run.asked).toHaveLength(0)
    expect(run.done.ok).toBe(true)
    expect(run.done.summary?.clientId).toBe('dcr-client-295')
  })

  it('mcpOAuthConfirm answers nothing when no flow asks', () => {
    expect(mcpOAuthConfirm('mcp-oauth-unknown', true)).toBe(false)
  })
})

describe('secretGateOf', () => {
  const server = new URL('https://mcp.example.com/mcp')
  it('null when the authorization server and token endpoint share the MCP server host', () => {
    expect(
      secretGateOf(
        server,
        'https://mcp.example.com:8443',
        new URL('https://MCP.example.com/token'),
      ),
    ).toBeNull()
  })
  it('a distinct key per authorization server and token endpoint origin', () => {
    const a = secretGateOf(
      server,
      'https://auth.example.com',
      new URL('https://auth.example.com/t'),
    )
    const b = secretGateOf(
      server,
      'https://auth.example.org',
      new URL('https://auth.example.org/t'),
    )
    const c = secretGateOf(server, 'https://auth.example.com', new URL('https://tok.example.com/t'))
    expect(a && b && c).toBeTruthy()
    expect(new Set([a?.key, b?.key, c?.key]).size).toBe(3)
  })
})
