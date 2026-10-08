/**
 * Issue #141 — MCP OAuth 2.1 debugger, REAL round trips (no SDK mocks).
 *
 * Resource server: the app's own Mock MCP server (`auth_mode: 'bearer'`),
 * whose RFC 9728 document points at a fake authorization server started here
 * on 127.0.0.1:0. The fake AS implements just enough of RFC 8414 / 7591 /
 * 6749 + PKCE: `/authorize` immediately 302s to the loopback redirect URI
 * (so the injected `openUrl` is a plain `fetch` that follows the redirect),
 * `/token` checks the PKCE verifier and the RFC 8707 `resource`.
 */
import http from 'node:http'
import { createHash, randomUUID } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { mockMcpServerManager } from '../../src/main/mock-mcp/server'
import type { MockMcpServerDef } from '../../src/main/mock-mcp/types'
import {
  createMcpOAuthFetch,
  mcpOAuthCancel,
  mcpOAuthForget,
  mcpOAuthHasToken,
  mcpOAuthStart,
  type McpOAuthDone,
  type McpOAuthHooks,
  type McpOAuthStartOptions,
  type McpOAuthStep,
} from '../../src/main/protocols/mcp-oauth.engine'
import { mcpConnect, mcpDisconnect, mcpListTools } from '../../src/main/protocols/mcp.engine'

const GOOD_TOKEN = 'at-GOOD-0123456789abcdef'
const STALE_TOKEN = 'at-STALE-0123456789abcdef'
const REFRESH_TOKEN = 'rt-0123456789abcdef-refresh'
const MANUAL_SECRET = 'manual-client-secret-xyz'

// ─── Fake authorization server ──────────────────────────────

interface AsOptions {
  registration?: boolean
  /** What `/authorize` sends back as `state` (default: echo). */
  stateOverride?: string
  /** `iss` on the redirect: undefined → the real issuer, null → omitted, string → that value. */
  iss?: string | null
  /** First token issued by the code grant (default GOOD_TOKEN). */
  firstToken?: string
  withRefresh?: boolean
}

interface FakeAs {
  origin: string
  opts: AsOptions
  registrations: Array<Record<string, unknown>>
  authorizeQueries: URLSearchParams[]
  tokenRequests: Array<{ params: URLSearchParams; authorization?: string }>
  /** Every PKCE verifier and code seen — must never surface in a step record. */
  seenSecrets: string[]
  close: () => Promise<void>
}

const b64url = (buf: Buffer): string => buf.toString('base64url')

async function startFakeAs(opts: AsOptions = {}): Promise<FakeAs> {
  const codes = new Map<string, { challenge: string; redirectUri: string; resource: string }>()
  const fake: FakeAs = {
    origin: '',
    opts,
    registrations: [],
    authorizeQueries: [],
    tokenRequests: [],
    seenSecrets: [],
    close: async () => {},
  }
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', fake.origin)
    const json = (status: number, body: unknown): void => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    let raw = ''
    req.on('data', (c: Buffer) => (raw += c.toString('utf8')))
    req.on('end', () => {
      if (req.method === 'GET' && url.pathname === '/.well-known/oauth-authorization-server') {
        json(200, {
          issuer: fake.origin,
          authorization_endpoint: `${fake.origin}/authorize`,
          token_endpoint: `${fake.origin}/token`,
          ...(opts.registration === false
            ? {}
            : { registration_endpoint: `${fake.origin}/register` }),
          response_types_supported: ['code'],
          grant_types_supported: ['authorization_code', 'refresh_token'],
          code_challenge_methods_supported: ['S256'],
          token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
        })
        return
      }
      if (req.method === 'POST' && url.pathname === '/register') {
        const body = JSON.parse(raw) as Record<string, unknown>
        fake.registrations.push(body)
        json(201, { ...body, client_id: 'dcr-client-1', client_id_issued_at: 1 })
        return
      }
      if (req.method === 'GET' && url.pathname === '/authorize') {
        fake.authorizeQueries.push(url.searchParams)
        const code = `code-${randomUUID()}`
        fake.seenSecrets.push(code)
        codes.set(code, {
          challenge: url.searchParams.get('code_challenge') ?? '',
          redirectUri: url.searchParams.get('redirect_uri') ?? '',
          resource: url.searchParams.get('resource') ?? '',
        })
        const back = new URL(url.searchParams.get('redirect_uri') ?? '')
        back.searchParams.set('code', code)
        back.searchParams.set('state', opts.stateOverride ?? url.searchParams.get('state') ?? '')
        if (opts.iss !== null) back.searchParams.set('iss', opts.iss ?? fake.origin)
        res.writeHead(302, { Location: back.href })
        res.end()
        return
      }
      if (req.method === 'POST' && url.pathname === '/token') {
        const params = new URLSearchParams(raw)
        fake.tokenRequests.push({
          params,
          ...(req.headers.authorization ? { authorization: req.headers.authorization } : {}),
        })
        if (params.get('grant_type') === 'refresh_token') {
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
      json(404, { error: 'not_found' })
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  fake.origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  fake.close = () =>
    new Promise<void>((resolve) => {
      server.close(() => resolve())
      server.closeAllConnections()
    })
  return fake
}

// ─── Mock MCP resource server ───────────────────────────────

function mcpDef(over: Partial<MockMcpServerDef>): MockMcpServerDef {
  return {
    id: `srv-${Math.random().toString(36).slice(2)}`,
    name: 'OAuth-protected mock',
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
    tools: [
      {
        name: 'echo',
        inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
        response: { kind: 'template', body: 'echo: {{args.text}}' },
      },
    ],
    resources: [],
    prompts: [],
    ...over,
  }
}

async function startMcp(over: Partial<MockMcpServerDef>): Promise<string> {
  const res = await mockMcpServerManager.start(mcpDef(over))
  if (!res.ok || !res.state.url) throw new Error(res.ok ? 'no url' : res.error)
  return res.state.url
}

// ─── Flow driver ────────────────────────────────────────────

interface Run {
  id: string
  done: McpOAuthDone
  events: McpOAuthStep[]
  /** Final record per step, in flow order. */
  final: McpOAuthStep[]
}

const browserFollow: McpOAuthHooks['openUrl'] = async (url) => {
  const r = await fetch(url)
  await r.text()
}

async function runFlow(
  options: McpOAuthStartOptions,
  hooks: Partial<McpOAuthHooks> = {},
  onStarted?: (id: string) => void,
): Promise<Run> {
  const events: McpOAuthStep[] = []
  let doneEvent: McpOAuthDone | undefined
  const { oauthSessionId, finished } = mcpOAuthStart(options, {
    openUrl: browserFollow,
    callbackTimeoutMs: 5_000,
    ...hooks,
    onStep: (_id, step) => events.push(step),
    onDone: (d) => {
      doneEvent = d
    },
  })
  onStarted?.(oauthSessionId)
  const done = await finished
  expect(doneEvent).toEqual(done)
  const final = new Map<string, McpOAuthStep>()
  for (const e of events) final.set(e.id, e)
  return {
    id: oauthSessionId,
    done,
    events,
    final: [...final.values()].sort((a, b) => a.index - b.index),
  }
}

function statuses(run: Run): string[] {
  return run.final.map((s) => `${s.index}:${s.id}:${s.status}`)
}

function assertNoSecrets(run: Run, secrets: string[]): void {
  const blob = JSON.stringify({ events: run.events, done: run.done })
  for (const secret of secrets) {
    if (secret) expect(blob).not.toContain(secret)
  }
}

let fakeAs: FakeAs | null = null
const startedIds: string[] = []

afterEach(async () => {
  for (const id of startedIds.splice(0)) mcpOAuthForget(id)
  await mockMcpServerManager.stopAll()
  if (fakeAs) await fakeAs.close()
  fakeAs = null
})

afterAll(async () => {
  await mockMcpServerManager.stopAll()
})

describe('MCP OAuth 2.1 debugger — happy path (DCR)', () => {
  it('passes all 7 steps in order, connects with the token, and forget brings the 401 back', async () => {
    fakeAs = await startFakeAs()
    const url = await startMcp({ authorizationServers: [fakeAs.origin] })

    // Baseline: without a token the bearer-protected mock refuses.
    await expect(mcpConnect({ transport: 'http', url })).rejects.toMatchObject({ code: 401 })

    const run = await runFlow({
      url,
      headers: { Authorization: 'Bearer user-row', 'X-Trace': 't1' },
    })
    startedIds.push(run.id)

    expect(run.done.ok).toBe(true)
    expect(statuses(run)).toEqual([
      '1:probe:passed',
      '2:resource-metadata:passed',
      '3:auth-server-metadata:passed',
      '4:client-registration:passed',
      '5:authorization-request:passed',
      '6:authorization-callback:passed',
      '7:token-exchange:passed',
    ])
    // Steps reach the renderer in flow order (each goes running → passed).
    const firstSeen = run.events.map((e) => e.index).filter((v, i, a) => a.indexOf(v) === i)
    expect(firstSeen).toEqual([1, 2, 3, 4, 5, 6, 7])

    // Step 1: probe without the user's Authorization, other headers kept.
    const probe = run.final[0]
    expect(probe.response?.status).toBe(401)
    expect(probe.note).toContain('resource_metadata=')
    expect(Object.keys(probe.request?.headers ?? {}).map((h) => h.toLowerCase())).not.toContain(
      'authorization',
    )
    expect(probe.request?.headers['x-trace']).toBe('t1')

    // Step 2/3: PRM points at the fake AS; AS metadata found at the root well-known.
    expect(run.final[1].note).toContain(`authorization_servers=[${fakeAs.origin}]`)
    expect(run.final[2].note).toContain(`issuer=${fakeAs.origin}`)

    // Step 4: DCR as a public native client with a loopback redirect.
    expect(fakeAs.registrations).toHaveLength(1)
    const reg = fakeAs.registrations[0]
    expect(reg).toMatchObject({
      client_name: 'Testnizer',
      application_type: 'native',
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
    })
    const redirectUri = (reg.redirect_uris as string[])[0]
    expect(redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/)

    // Step 5: PKCE S256 + state + RFC 8707 resource = canonical server URL.
    const q = fakeAs.authorizeQueries[0]
    expect(q.get('code_challenge_method')).toBe('S256')
    expect(q.get('client_id')).toBe('dcr-client-1')
    expect(q.get('resource')).toBe(url)
    expect(q.get('state')).toBeTruthy()
    expect(q.get('redirect_uri')).toBe(redirectUri)

    // Step 7: the token request carried the verifier and the resource.
    const tokenReq = fakeAs.tokenRequests[0].params
    expect(tokenReq.get('grant_type')).toBe('authorization_code')
    expect(tokenReq.get('resource')).toBe(url)
    expect(tokenReq.get('client_id')).toBe('dcr-client-1')
    // ...and its recorded form body shows the redaction placeholder verbatim,
    // not URL-encoded (`code=%E2%80%A2…`); non-secret fields stay wire-encoded.
    const shownBody = run.final[6].request?.body ?? ''
    expect(shownBody).toMatch(/(^|&)code=••••(&|$)/)
    expect(shownBody).toMatch(/(^|&)code_verifier=••••(&|$)/)
    expect(shownBody).toContain('grant_type=authorization_code')
    expect(shownBody).not.toContain('%E2%80%A2')
    // Step 6's recorded callback URL shows the same placeholder verbatim.
    const callbackUrl = run.final[5].request?.url ?? ''
    expect(callbackUrl).toMatch(/[?&]code=••••(&|$)/)
    expect(callbackUrl).not.toContain('%E2%80%A2')

    // Summary carries metadata only.
    expect(run.done.summary).toMatchObject({
      tokenType: 'Bearer',
      issuer: fakeAs.origin,
      clientId: 'dcr-client-1',
      scope: 'mcp:tools',
      hasRefreshToken: false,
      clientAuthMethod: 'none',
    })
    expect(run.done.summary?.expiresAt).toBeGreaterThan(Date.now())

    // No token, code or verifier anywhere in what left the engine.
    assertNoSecrets(run, [GOOD_TOKEN, ...fakeAs.seenSecrets])
    expect(JSON.stringify(run.events)).toContain('••••')
    expect(mcpOAuthHasToken(run.id)).toBe(true)

    // Step 8: connect with the session — the token beats the user's Authorization row.
    const info = await mcpConnect({
      transport: 'http',
      url,
      headers: { Authorization: 'Bearer user-row' },
      oauthSessionId: run.id,
    })
    const tools = await mcpListTools(info.connectionId)
    expect(tools.map((t) => t.name)).toEqual(['echo'])
    await mcpDisconnect(info.connectionId)

    // Forget drops the token: the same session id now gets the 401 again.
    expect(mcpOAuthForget(run.id)).toBe(true)
    expect(mcpOAuthHasToken(run.id)).toBe(false)
    await expect(
      mcpConnect({ transport: 'http', url, oauthSessionId: run.id }),
    ).rejects.toMatchObject({ code: 401 })
  })
})

describe('MCP OAuth 2.1 debugger — variants and failures', () => {
  it('a manual client id skips DCR; the secret is sent (client_secret_post) but never shown', async () => {
    fakeAs = await startFakeAs()
    const url = await startMcp({ authorizationServers: [fakeAs.origin] })
    const run = await runFlow({ url, clientId: 'manual-client', clientSecret: MANUAL_SECRET })
    startedIds.push(run.id)

    expect(run.done.ok).toBe(true)
    const reg = run.final[3]
    expect(reg.status).toBe('skipped')
    expect(reg.note).toContain('Manual client "manual-client"')
    expect(fakeAs.registrations).toHaveLength(0)
    const tokenReq = fakeAs.tokenRequests[0].params
    expect(tokenReq.get('client_id')).toBe('manual-client')
    expect(tokenReq.get('client_secret')).toBe(MANUAL_SECRET)
    expect(run.done.summary?.clientAuthMethod).toBe('client_secret_post')
    assertNoSecrets(run, [MANUAL_SECRET, GOOD_TOKEN, ...fakeAs.seenSecrets])
  })

  it('a tampered state fails step 6 and never reaches the token endpoint', async () => {
    fakeAs = await startFakeAs({ stateOverride: 'attacker-state' })
    const url = await startMcp({ authorizationServers: [fakeAs.origin] })
    const run = await runFlow({ url })

    expect(run.done.ok).toBe(false)
    expect(run.done.failedStep).toBe('authorization-callback')
    expect(run.final[5].status).toBe('failed')
    expect(run.final[5].error).toMatch(/state mismatch/)
    expect(run.final[6].status).toBe('skipped')
    expect(fakeAs.tokenRequests).toHaveLength(0)
    expect(mcpOAuthHasToken(run.id)).toBe(false)
  })

  it('an iss that is not the issuer fails step 6 (RFC 9207)', async () => {
    fakeAs = await startFakeAs({ iss: 'https://evil.example' })
    const url = await startMcp({ authorizationServers: [fakeAs.origin] })
    const run = await runFlow({ url })

    expect(run.done.ok).toBe(false)
    expect(run.final[5].status).toBe('failed')
    expect(run.final[5].error).toMatch(/iss mismatch/)
    expect(fakeAs.tokenRequests).toHaveLength(0)
  })

  it('no registration endpoint and no client id fails step 4 with a clear hint', async () => {
    fakeAs = await startFakeAs({ registration: false })
    const url = await startMcp({ authorizationServers: [fakeAs.origin] })
    const run = await runFlow({ url })

    expect(run.done.failedStep).toBe('client-registration')
    expect(run.final[3].error).toMatch(/Enter a Client ID/)
    expect(run.final.slice(4).every((s) => s.status === 'skipped')).toBe(true)
  })

  it('a server without auth stops after the probe', async () => {
    const url = await startMcp({ authMode: 'none' })
    const run = await runFlow({ url })

    expect(run.done).toMatchObject({ ok: true, noAuthRequired: true })
    expect(run.final[0].status).toBe('passed')
    expect(run.final.slice(1).every((s) => s.status === 'skipped')).toBe(true)
  })

  it('cancel while waiting for the browser ends the flow as cancelled', async () => {
    fakeAs = await startFakeAs()
    const url = await startMcp({ authorizationServers: [fakeAs.origin] })
    let id = ''
    const run = await runFlow(
      { url },
      {
        openUrl: () => {
          setTimeout(() => mcpOAuthCancel(id), 50)
        },
      },
      (started) => {
        id = started
      },
    )
    expect(run.done).toMatchObject({ ok: false, cancelled: true })
    expect(run.final[5].status).toBe('failed')
    expect(run.final[6].status).toBe('skipped')
  })

  it('a browser that never returns times out', async () => {
    fakeAs = await startFakeAs()
    const url = await startMcp({ authorizationServers: [fakeAs.origin] })
    const run = await runFlow({ url }, { openUrl: () => {}, callbackTimeoutMs: 150 })
    expect(run.done.ok).toBe(false)
    expect(run.final[5].error).toMatch(/Timed out/)
  })

  it('a 401 after connect refreshes the token once and retries', async () => {
    fakeAs = await startFakeAs({ firstToken: STALE_TOKEN, withRefresh: true })
    const url = await startMcp({ authorizationServers: [fakeAs.origin] })
    const run = await runFlow({ url })
    startedIds.push(run.id)
    expect(run.done.summary?.hasRefreshToken).toBe(true)
    assertNoSecrets(run, [STALE_TOKEN, REFRESH_TOKEN])

    const info = await mcpConnect({ transport: 'http', url, oauthSessionId: run.id })
    expect((await mcpListTools(info.connectionId)).map((t) => t.name)).toEqual(['echo'])
    await mcpDisconnect(info.connectionId)
    const refreshes = fakeAs.tokenRequests.filter(
      (r) => r.params.get('grant_type') === 'refresh_token',
    )
    expect(refreshes).toHaveLength(1)
  })
})

describe('MCP OAuth 2.1 debugger — legacy SSE transport', () => {
  it('probes with GET and authenticates the EventSource stream and the POSTs', async () => {
    fakeAs = await startFakeAs()
    const started = await mockMcpServerManager.start(
      mcpDef({ authorizationServers: [fakeAs.origin], legacySse: true }),
    )
    if (!started.ok || !started.state.sseUrl) throw new Error('mock did not start')
    const sseUrl = started.state.sseUrl

    await expect(mcpConnect({ transport: 'sse', url: sseUrl })).rejects.toMatchObject({ code: 401 })

    const run = await runFlow({ url: sseUrl, transport: 'sse' })
    startedIds.push(run.id)
    expect(run.done.ok).toBe(true)
    expect(run.final[0].request?.method).toBe('GET')
    expect(run.final[0].response?.status).toBe(401)

    const info = await mcpConnect({ transport: 'sse', url: sseUrl, oauthSessionId: run.id })
    expect((await mcpListTools(info.connectionId)).map((t) => t.name)).toEqual(['echo'])
    await mcpDisconnect(info.connectionId)
  })
})

describe('createMcpOAuthFetch', () => {
  it('passes requests through untouched for an unknown session', async () => {
    const seen: Array<string | null> = []
    const base = async (_url: string | URL, init?: RequestInit): Promise<Response> => {
      seen.push(new Headers(init?.headers).get('authorization'))
      return new Response('{}', { status: 200 })
    }
    const f = createMcpOAuthFetch('no-such-session', base)
    await f('http://127.0.0.1:1/mcp', { headers: { Authorization: 'Bearer mine' } })
    expect(seen).toEqual(['Bearer mine'])
  })
})
