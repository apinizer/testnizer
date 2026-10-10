/**
 * Issue #170 — plain-HTTP OAuth authorization server, as an explicit opt-in.
 *
 * Loopback hosts are exempt from the SDK's https rule, so a fake AS on
 * 127.0.0.1 would pass with or without the fix and prove nothing. Here the
 * fake AS is ADVERTISED as `http://auth.intranet.test:<port>` (a non-loopback
 * name) and a stubbed global `fetch` resolves that name — and the second
 * name `other.intranet.test` — to the fake's 127.0.0.1 listener. The fake
 * records which name each token request was addressed to, so the assertions
 * also prove it went to the intranet name, not to loopback.
 *
 * Resource server: the app's own Mock MCP server (`auth_mode: 'bearer'`),
 * whose RFC 9728 document points at the intranet AS.
 */
import http from 'node:http'
import { createHash, randomUUID } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockMcpServerManager } from '../../src/main/mock-mcp/server'
import type { MockMcpServerDef } from '../../src/main/mock-mcp/types'
import {
  createMcpOAuthFetch,
  mcpOAuthForget,
  mcpOAuthHasToken,
  mcpOAuthStart,
  plainHttpPinOf,
  usesPlainHttpTokenEndpoint,
  type McpOAuthDone,
  type McpOAuthHooks,
  type McpOAuthStartOptions,
  type McpOAuthStep,
} from '../../src/main/protocols/mcp-oauth.engine'

const AS_HOST = 'auth.intranet.test'
const OTHER_HOST = 'other.intranet.test'
const GOOD_TOKEN = 'at-GOOD-170-0123456789abcdef'
const STALE_TOKEN = 'at-STALE-170-0123456789abcdef'
const REFRESH_TOKEN = 'rt-170-0123456789abcdef-refresh'
const MANUAL_SECRET = 'manual-secret-170-xyz'

// ─── Fake intranet authorization server ─────────────────────

interface AsOptions {
  /** Host the metadata names for the token endpoint (default: AS_HOST). */
  tokenHost?: string
  /** Port the metadata names for the token endpoint (default: the AS's own). */
  tokenPort?: number
  authMethods?: string[]
  withRefresh?: boolean
  firstToken?: string
  /** Answers for the next refresh_token grants, in order. */
  refreshFailures?: Array<{ status: number; body: unknown }>
  /** `/token` answers 307 → `/token-elsewhere` (a credential re-send trap). */
  tokenRedirect?: boolean
}

interface TokenRequest {
  host: string
  params: URLSearchParams
  authorization?: string
}

interface FakeAs {
  port: number
  /** The advertised (non-loopback) issuer. */
  issuer: string
  tokenRequests: TokenRequest[]
  /** Requests that followed a `/token` redirect — must stay 0. */
  redirectedHits: number
  seenSecrets: string[]
  close: () => Promise<void>
}

const b64url = (buf: Buffer): string => buf.toString('base64url')

async function startFakeAs(opts: AsOptions = {}): Promise<FakeAs> {
  const codes = new Map<string, { challenge: string; redirectUri: string; resource: string }>()
  const fake: FakeAs = {
    port: 0,
    issuer: '',
    tokenRequests: [],
    redirectedHits: 0,
    seenSecrets: [],
    close: async () => {},
  }
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', fake.issuer)
    const json = (status: number, body: unknown): void => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    let raw = ''
    req.on('data', (c: Buffer) => (raw += c.toString('utf8')))
    req.on('end', () => {
      if (req.method === 'GET' && url.pathname === '/.well-known/oauth-authorization-server') {
        json(200, {
          issuer: fake.issuer,
          authorization_endpoint: `${fake.issuer}/authorize`,
          token_endpoint: `http://${opts.tokenHost ?? AS_HOST}:${opts.tokenPort ?? fake.port}/token`,
          registration_endpoint: `${fake.issuer}/register`,
          response_types_supported: ['code'],
          grant_types_supported: ['authorization_code', 'refresh_token'],
          code_challenge_methods_supported: ['S256'],
          token_endpoint_auth_methods_supported: opts.authMethods ?? ['none', 'client_secret_post'],
        })
        return
      }
      if (req.method === 'POST' && url.pathname === '/register') {
        const body = JSON.parse(raw) as Record<string, unknown>
        json(201, { ...body, client_id: 'dcr-client-170', client_id_issued_at: 1 })
        return
      }
      if (req.method === 'GET' && url.pathname === '/authorize') {
        const code = `code-${randomUUID()}`
        fake.seenSecrets.push(code)
        codes.set(code, {
          challenge: url.searchParams.get('code_challenge') ?? '',
          redirectUri: url.searchParams.get('redirect_uri') ?? '',
          resource: url.searchParams.get('resource') ?? '',
        })
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
        fake.tokenRequests.push({
          host: String(req.headers[ORIGINAL_HOST_HEADER] ?? req.headers.host ?? ''),
          params,
          ...(req.headers.authorization ? { authorization: req.headers.authorization } : {}),
        })
        if (opts.tokenRedirect) {
          res.writeHead(307, { Location: `${fake.issuer}/token-elsewhere` })
          res.end()
          return
        }
        if (params.get('grant_type') === 'refresh_token') {
          const failure = opts.refreshFailures?.shift()
          if (failure) {
            json(failure.status, failure.body)
            return
          }
          if (params.get('refresh_token') !== REFRESH_TOKEN) {
            json(400, { error: 'invalid_grant' })
            return
          }
          json(200, { access_token: GOOD_TOKEN, token_type: 'Bearer', expires_in: 3600 })
          return
        }
        const code = params.get('code') ?? ''
        const verifier = params.get('code_verifier') ?? ''
        fake.seenSecrets.push(verifier)
        const issued = codes.get(code)
        const challenge = b64url(createHash('sha256').update(verifier).digest())
        if (!issued || issued.challenge !== challenge) {
          json(400, { error: 'invalid_grant', error_description: 'PKCE verification failed' })
          return
        }
        if (
          params.get('resource') !== issued.resource ||
          params.get('redirect_uri') !== issued.redirectUri
        ) {
          json(400, { error: 'invalid_target' })
          return
        }
        json(200, {
          access_token: opts.firstToken ?? GOOD_TOKEN,
          token_type: 'Bearer',
          expires_in: 3600,
          scope: 'mcp:tools',
          ...(opts.withRefresh ? { refresh_token: REFRESH_TOKEN } : {}),
        })
        return
      }
      if (url.pathname === '/token-elsewhere') fake.redirectedHits += 1
      json(404, { error: 'not_found' })
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  fake.port = (server.address() as AddressInfo).port
  fake.issuer = `http://${AS_HOST}:${fake.port}`
  fake.close = () =>
    new Promise<void>((resolve) => {
      server.close(() => resolve())
      server.closeAllConnections()
    })
  return fake
}

// ─── Name resolution for the intranet hosts ─────────────────

const realFetch = globalThis.fetch
const ORIGINAL_HOST_HEADER = 'x-test-addressed-host'

/**
 * `fetch` that sends the two intranet names to 127.0.0.1 (same port) — the
 * stand-in for intranet DNS. undici drops a custom `Host`, so the name the
 * request was addressed to travels in a test-only header the fake AS reads.
 */
const intranetFetch: typeof fetch = (input, init) => {
  const raw = input instanceof Request ? input.url : String(input)
  const url = new URL(raw)
  if (url.hostname !== AS_HOST && url.hostname !== OTHER_HOST) return realFetch(input, init)
  const host = url.host
  url.hostname = '127.0.0.1'
  const headers = new Headers(init?.headers)
  headers.set(ORIGINAL_HOST_HEADER, host)
  return realFetch(url, { ...init, headers })
}

// ─── Mock MCP resource server ───────────────────────────────

function mcpDef(over: Partial<MockMcpServerDef>): MockMcpServerDef {
  return {
    id: `srv-${Math.random().toString(36).slice(2)}`,
    name: 'OAuth-protected mock (intranet AS)',
    description: '',
    host: '127.0.0.1',
    port: 0,
    path: '/mcp',
    legacySse: false,
    authMode: 'bearer',
    bearerToken: GOOD_TOKEN,
    latencyMs: 0,
    errorMode: { kind: 'none' },
    protocolPin: null,
    tools: [],
    resources: [],
    prompts: [],
    ...over,
  }
}

async function startMcp(fake: FakeAs): Promise<string> {
  const res = await mockMcpServerManager.start(mcpDef({ authorizationServers: [fake.issuer] }))
  if (!res.ok || !res.state.url) throw new Error(res.ok ? 'no url' : res.error)
  return res.state.url
}

// ─── Flow driver ────────────────────────────────────────────

interface Run {
  id: string
  done: McpOAuthDone
  events: McpOAuthStep[]
  final: McpOAuthStep[]
}

const browserFollow: McpOAuthHooks['openUrl'] = async (url) => {
  const r = await fetch(url)
  await r.text()
}

async function runFlow(options: McpOAuthStartOptions): Promise<Run> {
  const events: McpOAuthStep[] = []
  const { oauthSessionId, finished } = mcpOAuthStart(options, {
    openUrl: browserFollow,
    callbackTimeoutMs: 5_000,
    onStep: (_id, step) => events.push(step),
  })
  startedIds.push(oauthSessionId)
  const done = await finished
  const final = new Map<string, McpOAuthStep>()
  for (const e of events) final.set(e.id, e)
  return {
    id: oauthSessionId,
    done,
    events,
    final: [...final.values()].sort((a, b) => a.index - b.index),
  }
}

function tokenStep(run: Run): McpOAuthStep {
  const step = run.final.find((s) => s.id === 'token-exchange')
  if (!step) throw new Error('no token-exchange step')
  return step
}

function assertNoSecrets(run: Run, secrets: string[]): void {
  const blob = JSON.stringify({ events: run.events, done: run.done })
  for (const secret of secrets) {
    if (secret) expect(blob).not.toContain(secret)
  }
}

let fakeAs: FakeAs | null = null
const startedIds: string[] = []

beforeEach(() => {
  vi.stubGlobal('fetch', intranetFetch)
})

afterEach(async () => {
  vi.unstubAllGlobals()
  for (const id of startedIds.splice(0)) mcpOAuthForget(id)
  await mockMcpServerManager.stopAll()
  if (fakeAs) await fakeAs.close()
  fakeAs = null
})

afterAll(async () => {
  await mockMcpServerManager.stopAll()
})

// ─── Token exchange ─────────────────────────────────────────

describe('issue #170 — plain-HTTP authorization server: token exchange', () => {
  it('opt-in OFF: a non-loopback http token endpoint is still refused (unchanged)', async () => {
    fakeAs = await startFakeAs()
    const url = await startMcp(fakeAs)
    const run = await runFlow({ url })

    expect(run.done.ok).toBe(false)
    expect(run.done.failedStep).toBe('token-exchange')
    expect(tokenStep(run).error).toMatch(/non-https token endpoint/)
    expect(tokenStep(run).error).toContain(`http://${AS_HOST}:${fakeAs.port}/token`)
    // Discovery reached the intranet AS — so the refusal is the https rule,
    // not a resolution failure — and no credential was sent.
    expect(run.final[2].note).toContain(`issuer=${fakeAs.issuer}`)
    expect(fakeAs.tokenRequests).toHaveLength(0)
    expect(mcpOAuthHasToken(run.id)).toBe(false)
  })

  it('opt-in ON: the exchange runs over http with PKCE verifier, resource and public-client auth', async () => {
    fakeAs = await startFakeAs()
    const url = await startMcp(fakeAs)
    const run = await runFlow({ url, allowHttpAuthServer: true })

    expect(run.done.ok).toBe(true)
    expect(run.final.map((s) => s.status)).toEqual([
      'passed',
      'passed',
      'passed',
      'passed',
      'passed',
      'passed',
      'passed',
    ])
    expect(fakeAs.tokenRequests).toHaveLength(1)
    const req = fakeAs.tokenRequests[0]
    expect(req.host).toBe(`${AS_HOST}:${fakeAs.port}`)
    expect(req.params.get('grant_type')).toBe('authorization_code')
    expect(req.params.get('resource')).toBe(url)
    expect(req.params.get('client_id')).toBe('dcr-client-170')
    expect(req.params.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/)
    // The fake AS verified the PKCE challenge (else it would have answered 400).
    expect(req.params.get('code_verifier')).toBeTruthy()
    expect(req.params.get('client_secret')).toBeNull()
    expect(req.authorization).toBeUndefined()

    const step = tokenStep(run)
    expect(step.request?.url).toBe(`http://${AS_HOST}:${fakeAs.port}/token`)
    expect(step.request?.body).toMatch(/(^|&)code=••••(&|$)/)
    expect(step.request?.body).toMatch(/(^|&)code_verifier=••••(&|$)/)
    expect(step.note).toContain('plain-HTTP token endpoint')
    expect(run.done.summary).toMatchObject({
      clientAuthMethod: 'none',
      issuer: fakeAs.issuer,
      plainHttpTokenEndpoint: true,
    })
    expect(mcpOAuthHasToken(run.id)).toBe(true)
    assertNoSecrets(run, [GOOD_TOKEN, ...fakeAs.seenSecrets])
  })

  it('opt-in ON: a confidential client authenticates with client_secret_basic — secret never shown', async () => {
    fakeAs = await startFakeAs({ authMethods: ['client_secret_basic'] })
    const url = await startMcp(fakeAs)
    const run = await runFlow({
      url,
      allowHttpAuthServer: true,
      clientId: 'manual-170',
      clientSecret: MANUAL_SECRET,
    })

    expect(run.done.ok).toBe(true)
    const req = fakeAs.tokenRequests[0]
    expect(req.authorization).toBe(
      `Basic ${Buffer.from(`manual-170:${MANUAL_SECRET}`).toString('base64')}`,
    )
    expect(req.params.get('client_secret')).toBeNull()
    expect(req.params.get('client_id')).toBeNull()
    expect(run.done.summary?.clientAuthMethod).toBe('client_secret_basic')
    expect(tokenStep(run).request?.headers.authorization).toBe('Basic ••••')
    assertNoSecrets(run, [
      MANUAL_SECRET,
      Buffer.from(`manual-170:${MANUAL_SECRET}`).toString('base64'),
      GOOD_TOKEN,
      ...fakeAs.seenSecrets,
    ])
  })

  it('opt-in ON: a confidential client authenticates with client_secret_post', async () => {
    fakeAs = await startFakeAs({ authMethods: ['client_secret_post'] })
    const url = await startMcp(fakeAs)
    const run = await runFlow({
      url,
      allowHttpAuthServer: true,
      clientId: 'manual-170',
      clientSecret: MANUAL_SECRET,
    })

    expect(run.done.ok).toBe(true)
    const req = fakeAs.tokenRequests[0]
    expect(req.params.get('client_id')).toBe('manual-170')
    expect(req.params.get('client_secret')).toBe(MANUAL_SECRET)
    expect(req.authorization).toBeUndefined()
    assertNoSecrets(run, [MANUAL_SECRET, GOOD_TOKEN, ...fakeAs.seenSecrets])
  })

  it('opt-in ON: an http token endpoint on a DIFFERENT host is still refused', async () => {
    fakeAs = await startFakeAs({ tokenHost: OTHER_HOST })
    const url = await startMcp(fakeAs)
    const run = await runFlow({ url, allowHttpAuthServer: true })

    expect(run.done.ok).toBe(false)
    expect(run.done.failedStep).toBe('token-exchange')
    expect(tokenStep(run).error).toContain(`http://${OTHER_HOST}:${fakeAs.port}/token`)
    expect(tokenStep(run).error).toMatch(
      new RegExp(`covers ${AS_HOST.replace(/\./g, '\\.')}:${fakeAs.port} only`),
    )
    expect(fakeAs.tokenRequests).toHaveLength(0)
    expect(mcpOAuthHasToken(run.id)).toBe(false)
  })

  it('opt-in ON: an http token endpoint on the SAME host but a DIFFERENT port is refused', async () => {
    // Same intranet name, another port: another service — the opt-in was
    // given for the authorization server's host:port, not for the whole host.
    fakeAs = await startFakeAs({ tokenPort: 9 })
    const url = await startMcp(fakeAs)
    const run = await runFlow({ url, allowHttpAuthServer: true })

    expect(run.done.ok).toBe(false)
    expect(run.done.failedStep).toBe('token-exchange')
    expect(tokenStep(run).error).toContain(`http://${AS_HOST}:9/token`)
    expect(tokenStep(run).error).toMatch(/every other host or port requires HTTPS/)
    expect(fakeAs.tokenRequests).toHaveLength(0)
    expect(mcpOAuthHasToken(run.id)).toBe(false)
  })
})

describe('issue #170 — plain-HTTP opt-in pin (host + effective port)', () => {
  it('normalises default ports and compares host:port', () => {
    expect(plainHttpPinOf(new URL('http://AS.corp/x'))).toBe('as.corp:80')
    expect(plainHttpPinOf(new URL('http://as.corp:80/x'))).toBe('as.corp:80')
    expect(plainHttpPinOf(new URL('https://as.corp/x'))).toBe('as.corp:443')
    expect(plainHttpPinOf(new URL('http://as.corp:8080/x'))).toBe('as.corp:8080')
  })

  it('same host same port → plain-HTTP path; same host other port → refused', () => {
    const pin = plainHttpPinOf(new URL('http://as.corp:8080'))
    expect(usesPlainHttpTokenEndpoint(new URL('http://as.corp:8080/token'), pin)).toBe(true)
    expect(usesPlainHttpTokenEndpoint(new URL('http://AS.CORP:8080/oauth/token'), pin)).toBe(true)
    expect(() => usesPlainHttpTokenEndpoint(new URL('http://as.corp:9999/token'), pin)).toThrow(
      /covers as\.corp:8080 only/,
    )
    expect(() => usesPlainHttpTokenEndpoint(new URL('http://as.corp/token'), pin)).toThrow()
    // Default port written or omitted is the same endpoint.
    const pin80 = plainHttpPinOf(new URL('http://as.corp'))
    expect(usesPlainHttpTokenEndpoint(new URL('http://as.corp:80/token'), pin80)).toBe(true)
    // An https authorization server does not vouch for http on port 80.
    const pinTls = plainHttpPinOf(new URL('https://as.corp'))
    expect(() => usesPlainHttpTokenEndpoint(new URL('http://as.corp/token'), pinTls)).toThrow()
    // https / no opt-in → the SDK path, never the plain-HTTP one.
    expect(usesPlainHttpTokenEndpoint(new URL('https://as.corp:9999/token'), pin)).toBe(false)
    expect(usesPlainHttpTokenEndpoint(new URL('http://as.corp:9999/token'), undefined)).toBe(false)
  })
})

describe('issue #170 — plain-HTTP authorization server: redirects', () => {
  it('opt-in ON: a redirect from the token endpoint is not followed (no credential re-send)', async () => {
    fakeAs = await startFakeAs({ tokenRedirect: true })
    const url = await startMcp(fakeAs)
    const run = await runFlow({ url, allowHttpAuthServer: true })

    expect(run.done.ok).toBe(false)
    expect(run.done.failedStep).toBe('token-exchange')
    expect(tokenStep(run).error).toMatch(/HTTP 307 \(redirect\) — not followed/)
    expect(fakeAs.tokenRequests).toHaveLength(1)
    expect(fakeAs.redirectedHits).toBe(0)
    assertNoSecrets(run, fakeAs.seenSecrets)
  })
})

// ─── Refresh ────────────────────────────────────────────────

/** A resource-server stand-in: 401 for any token but GOOD_TOKEN. */
function resourceFetch(seen: string[]): typeof fetch {
  return async (_input, init) => {
    const auth = new Headers(init?.headers).get('authorization') ?? ''
    seen.push(auth)
    return new Response('{}', { status: auth === `Bearer ${GOOD_TOKEN}` ? 200 : 401 })
  }
}

describe('issue #170 — plain-HTTP authorization server: refresh', () => {
  it('opt-in ON: a 401 refreshes over http (refresh_token + resource + client_id) and retries', async () => {
    fakeAs = await startFakeAs({ firstToken: STALE_TOKEN, withRefresh: true })
    const url = await startMcp(fakeAs)
    const run = await runFlow({ url, allowHttpAuthServer: true })
    expect(run.done.summary?.hasRefreshToken).toBe(true)
    assertNoSecrets(run, [STALE_TOKEN, REFRESH_TOKEN])

    const seen: string[] = []
    const res = await createMcpOAuthFetch(run.id, resourceFetch(seen))(url, { method: 'POST' })
    expect(res.status).toBe(200)
    expect(seen).toEqual([`Bearer ${STALE_TOKEN}`, `Bearer ${GOOD_TOKEN}`])

    const refreshes = fakeAs.tokenRequests.filter(
      (r) => r.params.get('grant_type') === 'refresh_token',
    )
    expect(refreshes).toHaveLength(1)
    expect(refreshes[0].host).toBe(`${AS_HOST}:${fakeAs.port}`)
    expect(refreshes[0].params.get('refresh_token')).toBe(REFRESH_TOKEN)
    expect(refreshes[0].params.get('resource')).toBe(url)
    expect(refreshes[0].params.get('client_id')).toBe('dcr-client-170')
  })

  it('opt-in ON: invalid_grant on the http refresh is final — later 401s do not refresh again', async () => {
    fakeAs = await startFakeAs({
      firstToken: STALE_TOKEN,
      withRefresh: true,
      refreshFailures: [{ status: 400, body: { error: 'invalid_grant' } }],
    })
    const url = await startMcp(fakeAs)
    const run = await runFlow({ url, allowHttpAuthServer: true })
    expect(run.done.ok).toBe(true)

    const seen: string[] = []
    const oauthFetch = createMcpOAuthFetch(run.id, resourceFetch(seen))
    expect((await oauthFetch(url, { method: 'POST' })).status).toBe(401)
    expect((await oauthFetch(url, { method: 'POST' })).status).toBe(401)
    const refreshes = fakeAs.tokenRequests.filter(
      (r) => r.params.get('grant_type') === 'refresh_token',
    )
    expect(refreshes).toHaveLength(1)
  })

  it('switch turned OFF → the renderer forgets the session: no refresh is ever sent over HTTP', async () => {
    fakeAs = await startFakeAs({ firstToken: STALE_TOKEN, withRefresh: true })
    const url = await startMcp(fakeAs)
    const run = await runFlow({ url, allowHttpAuthServer: true })
    expect(run.done.summary?.plainHttpTokenEndpoint).toBe(true)

    // What `setOAuthAllowHttpAuthServer(false)` triggers through `mcp:oauth:forget`.
    expect(mcpOAuthForget(run.id)).toBe(true)
    expect(mcpOAuthHasToken(run.id)).toBe(false)

    const seen: string[] = []
    const res = await createMcpOAuthFetch(run.id, resourceFetch(seen))(url, { method: 'POST' })
    expect(res.status).toBe(401)
    expect(seen).toEqual([''])
    expect(
      fakeAs.tokenRequests.filter((r) => r.params.get('grant_type') === 'refresh_token'),
    ).toHaveLength(0)
  })

  it('opt-in OFF: no refresh is ever sent to the http token endpoint', async () => {
    // The flow cannot finish without the opt-in, so there is no session to
    // refresh — the 401 surfaces as it would without OAuth.
    fakeAs = await startFakeAs({ firstToken: STALE_TOKEN, withRefresh: true })
    const url = await startMcp(fakeAs)
    const run = await runFlow({ url })
    expect(run.done.ok).toBe(false)

    const seen: string[] = []
    const res = await createMcpOAuthFetch(run.id, resourceFetch(seen))(url, { method: 'POST' })
    expect(res.status).toBe(401)
    expect(seen).toEqual([''])
    expect(fakeAs.tokenRequests).toHaveLength(0)
  })
})
