/**
 * MCP Security Scan (issue #142) — `transport.*` and `auth.*` checks.
 */

import { isIP } from 'node:net'
import {
  discoverAuthorizationServerMetadata,
  discoverOAuthProtectedResourceMetadata,
} from '@modelcontextprotocol/sdk/client/auth.js'
import {
  checkResourceAllowed,
  resourceUrlFromServerUrl,
} from '@modelcontextprotocol/sdk/shared/auth-utils.js'
import type { OAuthProtectedResourceMetadata } from '@modelcontextprotocol/sdk/shared/auth.js'
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js'
import { errorMessage } from '../mcp-oauth.engine'
import {
  ev,
  info,
  isLoopbackHost,
  memo,
  pass,
  problem,
  skipped,
  type CheckDef,
  type CheckOutcome,
  type ScanContext,
} from './context'
import { REFS } from './refs'
import { CLIENT_INFO, type Exchange, type HttpResult } from './wire'

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

const SEVERITY_RANK = { info: 0, low: 1, medium: 2, high: 3, critical: 4 } as const

/** Several problems of one check folded into one outcome: worst status, worst severity. */
export function combine(
  problems: Array<{ status: 'fail' | 'warn'; severity: CheckOutcome['severity']; text: string }>,
  okDetail: string,
  recommendation: string,
  evidence?: CheckOutcome['evidence'],
): CheckOutcome {
  if (problems.length === 0) return pass(okDetail, evidence)
  const status = problems.some((p) => p.status === 'fail') ? 'fail' : 'warn'
  const relevant = problems.filter((p) => p.status === status)
  const severity = relevant.reduce<CheckOutcome['severity']>(
    (worst, p) => (SEVERITY_RANK[p.severity] > SEVERITY_RANK[worst] ? p.severity : worst),
    'info',
  )
  return problem(status, severity, problems.map((p) => p.text).join(' '), recommendation, evidence)
}

function initializeBody(id: string): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    id,
    method: 'initialize',
    params: { protocolVersion: LATEST_PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO },
  })
}

const isOk = (status: number | undefined): boolean =>
  status !== undefined && status >= 200 && status < 300

// ─── transport ──────────────────────────────────────────────

const https: CheckDef = {
  id: 'transport.https',
  category: 'transport',
  title: 'HTTPS',
  refs: [REFS.mcpAuthComms, REFS.mcpSecurity],
  run: (ctx) => {
    if (ctx.url.protocol === 'https:') return pass('The server is reached over HTTPS.')
    if (ctx.loopback) {
      return info(
        'Plain HTTP on a loopback address — acceptable for local development. Use HTTPS for any server reachable from other machines.',
      )
    }
    return problem(
      'fail',
      'high',
      'The server is reached over plain HTTP: access tokens, tool arguments and tool results cross the network unencrypted.',
      'Serve the MCP endpoint over HTTPS (TLS 1.2 or newer). The MCP authorization spec requires HTTPS for every non-loopback endpoint.',
    )
  },
}

const tlsCheck: CheckDef = {
  id: 'transport.tls',
  category: 'transport',
  title: 'TLS version and certificate',
  refs: [REFS.rfc8446, REFS.mcpAuthComms],
  run: async (ctx) => {
    if (ctx.url.protocol !== 'https:') {
      return skipped('Not applicable — the server is not reached over HTTPS.')
    }
    const host = ctx.url.hostname.replace(/^\[|\]$/g, '')
    const r = await ctx.inspectTls({
      host,
      port: ctx.url.port ? Number(ctx.url.port) : 443,
      ...(isIP(host) ? {} : { servername: host }),
      timeoutMs: ctx.http.timeoutMs,
    })
    if (!r.ok) {
      return skipped(
        `TLS handshake did not complete: ${r.error}. The scan presents no client certificate — a server that requires mTLS cannot be inspected here.`,
      )
    }
    const leaf = r.chain[0]
    const facts = [
      `protocol ${r.protocol ?? 'unknown'}`,
      r.cipher ? `cipher ${r.cipher.name}` : '',
      leaf ? `subject ${leaf.subjectDN}` : '',
      leaf ? `issuer ${leaf.issuerDN}` : '',
      leaf ? `valid until ${leaf.notAfter} (${r.daysToExpiry} days)` : '',
      `hostname ${r.hostnameValid ? 'matches' : 'does NOT match'}`,
      `chain ${r.authorized ? 'trusted' : `not trusted (${r.authorizationError ?? 'unknown reason'})`}`,
    ].filter(Boolean)
    const problems: Parameters<typeof combine>[0] = []
    if (r.protocol && /^(SSLv|TLSv1(\.1)?$)/.test(r.protocol)) {
      problems.push({ status: 'fail', severity: 'high', text: `${r.protocol} is obsolete.` })
    }
    if (r.expired)
      problems.push({ status: 'fail', severity: 'high', text: 'The certificate has expired.' })
    if (r.notYetValid) {
      problems.push({ status: 'fail', severity: 'high', text: 'The certificate is not valid yet.' })
    }
    if (!r.hostnameValid) {
      problems.push({
        status: 'fail',
        severity: 'high',
        text: `The certificate does not cover ${host}.`,
      })
    }
    if (!r.authorized && !r.expired && r.hostnameValid) {
      problems.push({
        status: 'fail',
        severity: ctx.loopback ? 'low' : 'medium',
        text: `The chain is not trusted (${r.authorizationError ?? (r.selfSigned ? 'self-signed' : 'unknown')}).`,
      })
    }
    if (!r.expired && r.daysToExpiry <= 14) {
      problems.push({
        status: 'warn',
        severity: 'low',
        text: `The certificate expires in ${r.daysToExpiry} days.`,
      })
    }
    return combine(
      problems,
      `TLS looks good: ${facts.join('; ')}.`,
      'Use TLS 1.2+ with a certificate from a trusted CA that covers the host name, and renew it before it expires.',
      { matches: facts },
    )
  },
}

const downgrade: CheckDef = {
  id: 'transport.downgrade',
  category: 'transport',
  title: 'Plain-HTTP downgrade',
  refs: [REFS.rfc6797, REFS.mcpAuthComms],
  run: async (ctx) => {
    if (ctx.url.protocol !== 'https:') {
      return skipped('Not applicable — the server URL is already plain HTTP.')
    }
    const plain = new URL(ctx.url.href)
    plain.protocol = 'http:'
    // Never send credentials over plain HTTP: anonymous headers only.
    const http = await ctx.http.send(
      plain.href,
      {
        method: 'POST',
        redirect: 'manual',
        headers: {
          ...ctx.anonHeaders,
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: initializeBody('tz-scan-downgrade'),
      },
      { auth: false },
    )
    const status = http.status
    if (status === undefined) {
      return pass(`Plain HTTP is refused (${http.error ?? 'no response'}).`, ev(http))
    }
    if (status >= 300 && status < 400) {
      const location = http.headers.get('location') ?? ''
      if (/^https:\/\//i.test(location)) {
        return pass(`Plain HTTP redirects to HTTPS (${status} → ${location}).`, ev(http))
      }
      return problem(
        'fail',
        'medium',
        `Plain HTTP answers ${status} with Location "${location || '(none)'}" — not a redirect to HTTPS.`,
        'Refuse plain HTTP or redirect it to the HTTPS URL, and send Strict-Transport-Security.',
        ev(http),
      )
    }
    if (isOk(status)) {
      const servesMcp = isRecord(http.json) && isRecord(http.json.result)
      return problem(
        'fail',
        servesMcp ? 'high' : 'medium',
        servesMcp
          ? `The MCP endpoint also answers initialize over plain HTTP (${plain.href} → ${status}).`
          : `${plain.href} answers ${status} over plain HTTP instead of refusing or redirecting.`,
        'Refuse plain HTTP or redirect it to HTTPS, and send Strict-Transport-Security so clients never retry over HTTP.',
        ev(http),
      )
    }
    if (status === 401 || status === 403) {
      return problem(
        'warn',
        'medium',
        `The endpoint is served over plain HTTP too and asks for credentials (HTTP ${status}) — a client pointed at http:// would send its token unencrypted.`,
        'Refuse plain HTTP or redirect it to HTTPS.',
        ev(http),
      )
    }
    return pass(`Plain HTTP answers ${status} — the MCP endpoint is not served over it.`, ev(http))
  },
}

// ─── auth ───────────────────────────────────────────────────

const unauthInitialize: CheckDef = {
  id: 'auth.unauth_initialize',
  category: 'auth',
  title: 'Unauthenticated access',
  refs: [REFS.mcpAuth, REFS.mcpSecurity],
  run: (ctx) => {
    const u = ctx.unauth
    if (!u || u.http.status === undefined) {
      return skipped(`No response to the unauthenticated probe (${u?.http.error ?? 'not run'}).`)
    }
    const status = u.http.status
    const evidence = ev(u.http)
    if (status === 401 || status === 403) {
      return pass(`An initialize without credentials is rejected with HTTP ${status}.`, evidence)
    }
    if (isOk(status)) {
      const serverInfo = isRecord(u.result?.serverInfo) ? u.result?.serverInfo : undefined
      const name = typeof serverInfo?.name === 'string' ? serverInfo.name : ''
      if (!u.result) {
        return info(
          `HTTP ${status} without credentials, but no JSON-RPC initialize result.`,
          evidence,
        )
      }
      if (ctx.loopback) {
        return info(
          `The server opens sessions without credentials${name ? ` (serverInfo.name "${name}")` : ''} — normal for a local development server on a loopback address.`,
          evidence,
        )
      }
      return problem(
        'warn',
        'medium',
        `The server completed initialize without any credentials${name ? ` (serverInfo.name "${name}")` : ''}: anyone who can reach it can list and call its tools.`,
        'Require OAuth 2.1 bearer tokens (MCP authorization spec) or put the endpoint behind an authenticating gateway — unless it is intentionally public and its tools are harmless.',
        evidence,
      )
    }
    return info(`An unauthenticated initialize got an unexpected HTTP ${status}.`, evidence)
  },
}

const wwwAuthenticate: CheckDef = {
  id: 'auth.www_authenticate',
  category: 'auth',
  title: 'WWW-Authenticate challenge',
  refs: [REFS.rfc9728Header, REFS.rfc6750Challenge, REFS.mcpAuth],
  run: (ctx) => {
    const u = ctx.unauth
    if (!u || u.http.status === undefined)
      return skipped('No response to the unauthenticated probe.')
    if (u.http.status !== 401) {
      return skipped(
        `Not applicable — the unauthenticated probe got HTTP ${u.http.status}, not 401.`,
      )
    }
    const header = u.http.headers.get('www-authenticate')
    const evidence = ev(u.http)
    const recommendation =
      'Answer 401 with `WWW-Authenticate: Bearer resource_metadata="<RFC 9728 metadata URL>"` so MCP clients can discover the authorization server.'
    if (!header) {
      return problem(
        'fail',
        'medium',
        'The 401 carries no WWW-Authenticate header, so clients cannot discover how to authorize.',
        recommendation,
        evidence,
      )
    }
    if (!/(^|,)\s*Bearer\b/i.test(header)) {
      return problem(
        'fail',
        'medium',
        `The challenge is not a Bearer challenge: "${header}".`,
        recommendation,
        evidence,
      )
    }
    if (!/\bresource_metadata\s*=/i.test(header)) {
      return problem(
        'warn',
        'medium',
        'Bearer challenge without `resource_metadata` — clients must fall back to /.well-known discovery.',
        recommendation,
        evidence,
      )
    }
    return pass(`401 with a Bearer challenge naming the resource metadata: ${header}`, evidence)
  },
}

interface PrmResult {
  state: 'na' | 'ok' | 'error'
  doc?: OAuthProtectedResourceMetadata
  error?: string
  attempts: Exchange[]
}

function discoverPrm(ctx: ScanContext): Promise<PrmResult> {
  return memo(ctx, 'prm', async (): Promise<PrmResult> => {
    const status = ctx.unauth?.http.status
    if (status !== 401 && status !== 403) return { state: 'na', attempts: [] }
    const header = ctx.unauth?.http.headers.get('www-authenticate') ?? ''
    const m = /resource_metadata\s*=\s*(?:"([^"]+)"|([^\s,]+))/i.exec(header)
    let advertised: URL | undefined
    try {
      if (m) advertised = new URL(m[1] ?? m[2], ctx.url)
    } catch {
      advertised = undefined
    }
    const attempts: Exchange[] = []
    try {
      const doc = await discoverOAuthProtectedResourceMetadata(
        ctx.url,
        advertised ? { resourceMetadataUrl: advertised } : {},
        ctx.http.fetchLike(attempts),
      )
      return { state: 'ok', doc, attempts }
    } catch (err) {
      return { state: 'error', error: errorMessage(err), attempts }
    }
  })
}

function attemptEvidence(attempts: Exchange[]): CheckOutcome['evidence'] {
  const last = attempts[attempts.length - 1]
  const matches = attempts.map(
    (a) =>
      `${a.request?.method ?? 'GET'} ${a.request?.url ?? ''} → ${a.response ? `HTTP ${a.response.status}` : (a.error ?? 'error')}`,
  )
  return { ...(last ?? {}), ...(matches.length ? { matches } : {}) }
}

/** RFC 8707 canonical URI: no fragment, no trailing slash (except the root). */
function canonicalResource(serverUrl: URL): URL {
  const url = resourceUrlFromServerUrl(serverUrl)
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '')
  return url
}

const prmReachable: CheckDef = {
  id: 'auth.prm_reachable',
  category: 'auth',
  title: 'Protected Resource Metadata (RFC 9728)',
  refs: [REFS.rfc9728, REFS.mcpAuth],
  run: async (ctx) => {
    const prm = await discoverPrm(ctx)
    if (prm.state === 'na') {
      return skipped('Not applicable — the server did not ask for authorization (no 401).')
    }
    const evidence = attemptEvidence(prm.attempts)
    if (prm.state === 'error' || !prm.doc) {
      return problem(
        'fail',
        'medium',
        `The Protected Resource Metadata document could not be fetched: ${prm.error ?? 'unknown error'}.`,
        'Publish an RFC 9728 document (at the URL named by `resource_metadata`, or /.well-known/oauth-protected-resource) listing `resource` and `authorization_servers`.',
        evidence,
      )
    }
    const canonical = canonicalResource(ctx.url)
    const problems: Parameters<typeof combine>[0] = []
    if (
      !checkResourceAllowed({ requestedResource: canonical, configuredResource: prm.doc.resource })
    ) {
      problems.push({
        status: 'fail',
        severity: 'medium',
        text: `\`resource\` "${prm.doc.resource}" does not match the server URL ${canonical.href} (RFC 9728 §3.3).`,
      })
    }
    const servers = prm.doc.authorization_servers ?? []
    if (servers.length === 0) {
      problems.push({
        status: 'warn',
        severity: 'medium',
        text: 'The document lists no `authorization_servers`, so clients cannot find where to obtain a token.',
      })
    }
    return combine(
      problems,
      `resource=${prm.doc.resource}; authorization_servers=[${servers.join(', ')}].`,
      'Make `resource` the canonical server URL and list at least one authorization server.',
      evidence,
    )
  },
}

const asMetadata: CheckDef = {
  id: 'auth.as_metadata',
  category: 'auth',
  title: 'Authorization server metadata (RFC 8414)',
  refs: [REFS.rfc8414, REFS.rfc7636, REFS.mcpAuth],
  run: async (ctx) => {
    const prm = await discoverPrm(ctx)
    if (prm.state !== 'ok' || !prm.doc) {
      return skipped('Not applicable — no Protected Resource Metadata to follow.')
    }
    const as = prm.doc.authorization_servers?.[0]
    if (!as) return skipped('The Protected Resource Metadata names no authorization server.')
    const attempts: Exchange[] = []
    let meta: Awaited<ReturnType<typeof discoverAuthorizationServerMetadata>>
    try {
      meta = await discoverAuthorizationServerMetadata(as, {
        fetchFn: ctx.http.fetchLike(attempts),
      })
    } catch (err) {
      return problem(
        'fail',
        'medium',
        `Authorization server metadata for ${as} could not be read: ${errorMessage(err)}.`,
        'Publish RFC 8414 (/.well-known/oauth-authorization-server) or OpenID Connect discovery metadata.',
        attemptEvidence(attempts),
      )
    }
    const evidence = attemptEvidence(attempts)
    if (!meta) {
      return problem(
        'fail',
        'medium',
        `No RFC 8414 / OIDC discovery document for ${as}.`,
        'Publish RFC 8414 (/.well-known/oauth-authorization-server) or OpenID Connect discovery metadata.',
        evidence,
      )
    }
    const problems: Parameters<typeof combine>[0] = []
    const methods = meta.code_challenge_methods_supported
    if (!methods || !methods.includes('S256')) {
      problems.push({
        status: 'fail',
        severity: 'high',
        text: methods
          ? `code_challenge_methods_supported=[${methods.join(', ')}] lacks S256.`
          : 'code_challenge_methods_supported is absent — MCP clients must refuse to proceed without advertised PKCE S256.',
      })
    }
    for (const [key, value] of [
      ['authorization_endpoint', meta.authorization_endpoint],
      ['token_endpoint', meta.token_endpoint],
    ] as const) {
      try {
        const u = new URL(value)
        if (u.protocol !== 'https:' && !isLoopbackHost(u.hostname)) {
          problems.push({ status: 'fail', severity: 'high', text: `${key} ${value} is not HTTPS.` })
        }
      } catch {
        problems.push({
          status: 'fail',
          severity: 'medium',
          text: `${key} "${value}" is not a URL.`,
        })
      }
    }
    if (meta.issuer.replace(/\/+$/, '') !== as.replace(/\/+$/, '')) {
      problems.push({
        status: 'warn',
        severity: 'low',
        text: `issuer ${meta.issuer} differs from the authorization server URL ${as} (RFC 8414 §3.3).`,
      })
    }
    return combine(
      problems,
      `issuer=${meta.issuer}; PKCE S256 advertised; authorization_endpoint and token_endpoint are HTTPS.`,
      'Advertise `code_challenge_methods_supported: ["S256"]` and serve every endpoint over HTTPS.',
      evidence,
    )
  },
}

const tokenInQuery: CheckDef = {
  id: 'auth.token_in_query',
  category: 'auth',
  title: 'Access token in the query string',
  refs: [REFS.rfc6750Query, REFS.mcpAuthTokens],
  run: async (ctx) => {
    const status = ctx.unauth?.http.status
    if (status === undefined) return skipped('No response to the unauthenticated probe.')
    if (status !== 401 && status !== 403) {
      return skipped('Not applicable — the server does not require authorization.')
    }
    const url = new URL(ctx.url.href)
    url.searchParams.set('access_token', 'testnizer-scan-dummy-token')
    let http: HttpResult
    if (ctx.transport === 'sse') {
      http = await ctx.http.send(
        url.href,
        { method: 'GET', headers: { ...ctx.anonHeaders, Accept: 'text/event-stream' } },
        { auth: false, discardBody: true },
      )
    } else {
      http = await ctx.http.send(
        url.href,
        {
          method: 'POST',
          headers: {
            ...ctx.anonHeaders,
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
          },
          body: initializeBody('tz-scan-query-token'),
        },
        { auth: false, wantId: 'tz-scan-query-token' },
      )
    }
    const evidence = ev(http)
    if (http.status === undefined) return skipped(`No response (${http.error ?? 'unknown error'}).`)
    const recommendation =
      'Accept access tokens only in the Authorization header (RFC 6750 §2.1); MCP servers must not accept tokens in the URI query string.'
    if (isOk(http.status)) {
      return problem(
        'fail',
        'high',
        `A request with ?access_token=<dummy> and no Authorization header was accepted (HTTP ${http.status}) — the server authenticates query-string tokens without validating them, or skips authentication when the parameter is present.`,
        recommendation,
        evidence,
      )
    }
    const challenge = http.headers.get('www-authenticate') ?? ''
    if (/error\s*=\s*"?invalid_token/i.test(challenge)) {
      return problem(
        'warn',
        'medium',
        'The dummy query-string token was rejected as invalid_token — the server reads access tokens from the query string, where they end up in logs and browser history.',
        recommendation,
        evidence,
      )
    }
    return pass(`A query-string token is ignored (HTTP ${http.status}).`, evidence)
  },
}

export const TRANSPORT_AUTH_CHECKS: CheckDef[] = [
  https,
  tlsCheck,
  downgrade,
  unauthInitialize,
  wwwAuthenticate,
  prmReachable,
  asMetadata,
  tokenInQuery,
]
