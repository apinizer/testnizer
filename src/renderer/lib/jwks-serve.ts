import type { MockEndpoint, MockResponse } from '../types'

/**
 * JWKS-serve (#61 / Faz D1) — the renderer half.
 *
 * ── D1-1: ZERO new mock primitives ──────────────────────────────────────────
 *
 * The mock model has no "rule" type. Serving a JWKS is exactly one ordinary
 * `mock_endpoints` row (`GET /.well-known/jwks.json`, `path_mode:'exact'`) plus
 * one ordinary `mock_responses` row (`200`, `body_type:'json'`,
 * `condition:{type:'always'}`), both created through the EXISTING
 * `mock:endpoint:create` / `mock:response:create` IPC. This module holds the
 * exact row shapes and nothing else — no new channel, no new column, no engine
 * change. `path_mode:'exact'` is a literal compare, so the dots and the extra
 * segment in `/.well-known/jwks.json` need no escaping and it out-scores any
 * param/wildcard endpoint on the same path.
 *
 * ── D1-2: the body is STATIC ────────────────────────────────────────────────
 *
 * The mock response script sandbox has no `require`/`node:crypto`/`jose`, so
 * the document can never be generated per request. It is pre-computed in MAIN
 * (`jwks:build`) and stored verbatim. Rotation = build again + `response:update`
 * (which hot-reloads a running server) — see `JwksFillButton`.
 *
 * ── D1-3: base path ────────────────────────────────────────────────────────
 *
 * `handleRequest` strips the server's `base_path` BEFORE matching, so the
 * endpoint path is always stored post-strip (`/.well-known/jwks.json`) and the
 * URL a caller actually uses is `basePath + path`. Provision on a server with an
 * empty base path (the default) to get the canonical well-known URL;
 * `jwksServeUrl` surfaces the effective one either way.
 */

/** The RFC 8615 well-known location. Stored POST-base-path-strip (D1-3). */
export const JWKS_WELL_KNOWN_PATH = '/.well-known/jwks.json'

export interface JwksEndpointInput {
  serverId: string
  method: 'GET'
  path: string
  pathMode: 'exact'
}

export interface JwksResponseInput {
  endpointId: string
  name: string
  statusCode: number
  headers: { name: string; value: string }[]
  bodyType: 'json'
  body: string
  delayMs: number
  condition: { type: 'always' }
  script: string
  order: number
  enabled: boolean
}

/** The one endpoint row a JWKS needs (D1-1). */
export function jwksEndpointInput(
  serverId: string,
  path = JWKS_WELL_KNOWN_PATH,
): JwksEndpointInput {
  return { serverId, method: 'GET', path, pathMode: 'exact' }
}

/**
 * The one response row a JWKS needs (D1-1/D1-2).
 *
 * No explicit `content-type` header: `body_type:'json'` already makes the
 * engine send `application/json; charset=utf-8`, which is what a JWKS wants —
 * and leaving it implicit keeps this row identical in shape to every
 * hand-authored JSON response.
 */
export function jwksResponseInput(endpointId: string, body: string, order = 0): JwksResponseInput {
  return {
    endpointId,
    name: 'JWKS',
    statusCode: 200,
    headers: [],
    bodyType: 'json',
    body,
    delayMs: 0,
    condition: { type: 'always' },
    script: '',
    order,
    enabled: true,
  }
}

/** `0.0.0.0` is a bind address, not something a client can dial. */
function displayHost(host: string): string {
  return host === '0.0.0.0' ? '127.0.0.1' : host
}

/** `''` → `''`; `api` → `/api`; `/api/` → `/api`. */
function normaliseBasePath(basePath: string): string {
  const trimmed = (basePath ?? '').trim().replace(/\/+$/, '')
  if (trimmed === '') return ''
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`
}

/**
 * The URL a verifier must fetch (D1-3): base path + the stored, post-strip path.
 * With the default empty base path this is exactly
 * `http://127.0.0.1:<port>/.well-known/jwks.json`.
 */
export function jwksServeUrl(
  server: { host: string; port: number; basePath: string },
  path = JWKS_WELL_KNOWN_PATH,
): string {
  return `http://${displayHost(server.host)}:${server.port}${normaliseBasePath(server.basePath)}${path}`
}

/** True for an endpoint that serves the well-known JWKS document. */
export function isJwksEndpoint(endpoint: Pick<MockEndpoint, 'method' | 'path'>): boolean {
  return endpoint.method === 'GET' && endpoint.path.replace(/\/+$/, '') === JWKS_WELL_KNOWN_PATH
}

/**
 * The public JWKs already present in a response body, or `[]` when the body is
 * not a JWKS document.
 *
 * Used so a second "Fill from Security" pick EXTENDS the set (rotation) rather
 * than discarding what is there. Deliberately forgiving: a hand-authored body
 * that is not a JWKS simply contributes nothing, and is replaced only because
 * the user explicitly asked to fill. Sanitizing is main's job — anything
 * returned here goes back through `buildJwks`, which strips private members and
 * refuses symmetric keys.
 */
export function parseJwksKeys(body: string): JsonWebKey[] {
  if (!body || body.trim() === '') return []
  try {
    const parsed = JSON.parse(body) as { keys?: unknown }
    if (!parsed || !Array.isArray(parsed.keys)) return []
    return parsed.keys.filter(
      (k): k is JsonWebKey => !!k && typeof k === 'object' && !Array.isArray(k),
    )
  } catch {
    return []
  }
}

/**
 * Create the endpoint+response pair that serves `body`, through the caller's
 * EXISTING store actions (which are thin wrappers over `mock:endpoint:create` /
 * `mock:response:create`). Injected rather than imported so this stays a pure,
 * testable function and so it cannot grow a second, private IPC path.
 */
export async function provisionJwksServe(args: {
  serverId: string
  body: string
  path?: string
  createEndpoint: (input: JwksEndpointInput) => Promise<MockEndpoint | null>
  createResponse: (input: JwksResponseInput) => Promise<MockResponse | null>
}): Promise<{ endpoint: MockEndpoint; response: MockResponse }> {
  const endpoint = await args.createEndpoint(jwksEndpointInput(args.serverId, args.path))
  if (!endpoint) throw new Error('Could not create the JWKS endpoint.')
  const response = await args.createResponse(jwksResponseInput(endpoint.id, args.body))
  if (!response) throw new Error('Could not create the JWKS response.')
  return { endpoint, response }
}
