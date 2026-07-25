/**
 * JWKS-serve (#61 / Faz D1) — the END-TO-END proof.
 *
 * This file is the mandated security gate of D1-4: it starts a REAL mock HTTP
 * server, fetches the JWKS over the wire, and asserts on the bytes that came
 * back — not on an in-process object. Everything upstream (`resolveKeyMaterial`
 * → `buildJwks` → `jwks:build`) is exercised through the same handlers the UI
 * calls, so a leak anywhere in the chain shows up here.
 *
 * What each block pins:
 *
 *  1. D1-1 — ZERO new mock primitives. The endpoint and the response are created
 *     through the EXISTING `mock:endpoint:create` / `mock:response:create` IPC
 *     with an ordinary `{GET, exact}` row and an ordinary `{200, json, always}`
 *     row. If serving a JWKS ever needed a new column or a new rule type, this
 *     test could not be written this way.
 *  2. D1-3 — with `base_path=''` the served URL is exactly
 *     `/.well-known/jwks.json`; with a base path the SAME stored (post-strip)
 *     path is reached at `base + path`.
 *  3. D1-4 (HARD) — every key fetched over HTTP has none of
 *     `d,p,q,dp,dq,qi,k`, and the document is `createLocalJWKSet`-acceptable:
 *     a token signed with the matching private key actually verifies against it.
 *  4. ADDITIVE — a hand-authored body still serves byte-for-byte; the JWKS
 *     auto-fill writes into that same field and changes nothing about how a
 *     hand-written response behaves.
 *  5. ROTATION (D1-2) — recompute in main + `mock:response:update` hot-reloads a
 *     RUNNING server, so a second key appears without a restart and without any
 *     request-time generation.
 */

// reflect-metadata MUST load before @peculiar/x509 (keystore-bridge pulls it in).
import 'reflect-metadata'
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import http from 'node:http'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  setupHandlerHarness,
  makeElectronMock,
  createTestDb,
  seedProject,
  seedWorkspace,
} from './handlers/helpers'

const harness = setupHandlerHarness()
vi.mock('electron', () => makeElectronMock())

let testDb: ReturnType<typeof createTestDb>
vi.mock('../../src/main/db/database', () => ({
  getDb: () => testDb,
}))

// NOTE: `mock/server` is deliberately NOT stubbed — the whole point is a real
// listener answering a real GET.
const { registerMockHandlers } = await import('../../src/main/ipc/mock.handler')
const { registerJwksHandlers } = await import('../../src/main/ipc/jwks.handler')
const { mockServerManager } = await import('../../src/main/mock/server')
const { privateKeyFromPem, signJwt, verifyJwtWithJwks } =
  await import('../../src/main/lib/jose-runtime')
const { resolveKeyMaterial } = await import('../../src/main/lib/keystore-bridge')

const CERTS = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/certs')
const fixture = (f: string): string => readFileSync(join(CERTS, f), 'utf8')

const PRIVATE_MEMBERS = ['d', 'p', 'q', 'dp', 'dq', 'qi', 'k'] as const

const RSA_SOURCE = {
  kind: 'inline' as const,
  certPem: fixture('client.crt'),
  keyPem: fixture('client.pkcs8.key'),
}
const EC_SOURCE = {
  kind: 'inline' as const,
  certPem: fixture('ec-p256.crt'),
  keyPem: fixture('ec-p256.pkcs8.key'),
}

/** A JWKS body a user typed by hand — the additive-regression subject. */
const HAND_AUTHORED_BODY = '{\n  "keys": [],\n  "note": "typed by hand"\n}'

interface Envelope<T> {
  success: boolean
  data?: T
  error?: string
}

/** Grab a port the OS just told us is free. */
async function freePort(): Promise<number> {
  const probe = http.createServer()
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', () => resolve()))
  const addr = probe.address()
  const port = addr && typeof addr === 'object' ? addr.port : 0
  await new Promise<void>((resolve) => probe.close(() => resolve()))
  return port
}

function httpGet(
  url: string,
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        )
      })
      .on('error', reject)
  })
}

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const res = (await harness.invoke(channel, ...args)) as Envelope<T>
  if (!res.success || res.data === undefined) {
    throw new Error(`${channel} failed: ${res.error ?? 'no data'}`)
  }
  return res.data
}

let serverId: string
let port: number
let jwksResponseId: string
let jwksUrl: string
let handUrl: string

beforeAll(async () => {
  harness.reset()
  testDb = createTestDb()
  registerMockHandlers()
  registerJwksHandlers()

  const projectId = seedProject(testDb, seedWorkspace(testDb))
  port = await freePort()

  // D1-3: base path left at its default ''. The served URL is then exactly the
  // canonical well-known location.
  const server = await invoke<{ id: string; basePath: string }>('mock:server:create', {
    projectId,
    name: 'JWKS',
    port,
  })
  serverId = server.id
  expect(server.basePath).toBe('')

  // ── D1-1: one ORDINARY endpoint row, through the existing IPC ──
  const endpoint = await invoke<{ id: string; method: string; path: string; pathMode: string }>(
    'mock:endpoint:create',
    { serverId, method: 'GET', path: '/.well-known/jwks.json', pathMode: 'exact' },
  )
  expect(endpoint.method).toBe('GET')
  expect(endpoint.pathMode).toBe('exact')

  // ── D1-2: the body is a STATIC string built in MAIN at configure time ──
  const built = await invoke<{ body: string; kids: string[]; count: number }>('jwks:build', {
    sources: [RSA_SOURCE],
  })

  // ── D1-1: one ORDINARY response row, through the existing IPC ──
  const response = await invoke<{ id: string }>('mock:response:create', {
    endpointId: endpoint.id,
    statusCode: 200,
    bodyType: 'json',
    body: built.body,
    condition: { type: 'always' },
  })
  jwksResponseId = response.id

  // A hand-authored response on its own endpoint — the additive-regression
  // subject, created exactly the way it always was.
  const handEndpoint = await invoke<{ id: string }>('mock:endpoint:create', {
    serverId,
    method: 'GET',
    path: '/hand-written.json',
    pathMode: 'exact',
  })
  await invoke('mock:response:create', {
    endpointId: handEndpoint.id,
    statusCode: 200,
    bodyType: 'json',
    body: HAND_AUTHORED_BODY,
    condition: { type: 'always' },
  })

  await invoke('mock:server:start', serverId)
  jwksUrl = `http://127.0.0.1:${port}/.well-known/jwks.json`
  handUrl = `http://127.0.0.1:${port}/hand-written.json`
}, 30000)

afterAll(async () => {
  await mockServerManager.stop(serverId)
})

// ═══════════════════════════════════════════════════════════════════════════
// 1. D1-4 (HARD) — GET the served document and assert on the BYTES
// ═══════════════════════════════════════════════════════════════════════════

describe('JWKS served over HTTP — public-JWK-only (D1-4)', () => {
  it('serves the document at the exact well-known path with a JSON content-type', async () => {
    const res = await httpGet(jwksUrl)
    expect(res.status).toBe(200)
    expect(String(res.headers['content-type'])).toContain('application/json')
  })

  it('every served key has NONE of d,p,q,dp,dq,qi,k', async () => {
    const res = await httpGet(jwksUrl)
    const doc = JSON.parse(res.body) as { keys: Record<string, unknown>[] }
    expect(doc.keys.length).toBeGreaterThan(0)
    for (const key of doc.keys) {
      for (const member of PRIVATE_MEMBERS) {
        expect(key).not.toHaveProperty(member)
      }
    }
    // Assert on the raw text too — a member nested somewhere unexpected would
    // pass the per-key check above but still be on the wire.
    for (const member of PRIVATE_MEMBERS) {
      expect(res.body).not.toContain(`"${member}"`)
    }
  })

  it('does not leak the private key material of the source it was built from', async () => {
    const material = resolveKeyMaterial(RSA_SOURCE, 'jwk')
    const privateD = material.privateJwk?.d
    expect(typeof privateD).toBe('string')
    const res = await httpGet(jwksUrl)
    expect(res.body).not.toContain(String(privateD))
    // The PUBLIC half is present — the document is useful, not merely empty.
    expect(res.body).toContain(String(material.publicJwk?.n))
  })

  it('is createLocalJWKSet-acceptable and verifies a real token signed by the private half', async () => {
    const res = await httpGet(jwksUrl)
    const doc = JSON.parse(res.body) as { keys: JsonWebKey[] }
    const material = resolveKeyMaterial(RSA_SOURCE, 'jwk')

    const signingKey = await privateKeyFromPem(fixture('client.pkcs8.key'), 'RS256')
    const token = await signJwt({ sub: 'served' }, signingKey, 'RS256', {
      kid: material.publicJwk?.kid,
    })

    // createLocalJWKSet (inside verifyJwtWithJwks) throws on a malformed set, so
    // reaching a payload proves BOTH shape-acceptance and kid-based selection.
    const verified = await verifyJwtWithJwks(token, doc as never, ['RS256'])
    expect(verified.payload.sub).toBe('served')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 2. ADDITIVE — a hand-authored body is untouched
// ═══════════════════════════════════════════════════════════════════════════

describe('hand-authored mock bodies keep serving byte-for-byte', () => {
  it('returns the typed body verbatim, JWKS feature or not', async () => {
    const res = await httpGet(handUrl)
    expect(res.status).toBe(200)
    expect(res.body).toBe(HAND_AUTHORED_BODY)
    expect(String(res.headers['content-type'])).toContain('application/json')
  })

  it('a hand-authored body is unaffected by rebuilding the JWKS response next to it', async () => {
    const rebuilt = await invoke<{ body: string }>('jwks:build', { sources: [RSA_SOURCE] })
    await invoke('mock:response:update', jwksResponseId, { body: rebuilt.body })
    const res = await httpGet(handUrl)
    expect(res.body).toBe(HAND_AUTHORED_BODY)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 3. ROTATION (D1-2) — recompute in main + response:update, no restart
// ═══════════════════════════════════════════════════════════════════════════

describe('key rotation', () => {
  it('adds a second key by rebuilding + mock:response:update on a RUNNING server', async () => {
    const before = JSON.parse((await httpGet(jwksUrl)).body) as { keys: { kid: string }[] }
    expect(before.keys).toHaveLength(1)

    // The new key leads; the previously published key rides along so tokens
    // still in flight keep verifying.
    const rotated = await invoke<{ body: string; count: number; kids: string[] }>('jwks:build', {
      sources: [EC_SOURCE],
      extraKeys: before.keys,
    })
    expect(rotated.count).toBe(2)
    await invoke('mock:response:update', jwksResponseId, { body: rotated.body })

    const res = await httpGet(jwksUrl)
    const doc = JSON.parse(res.body) as { keys: Record<string, unknown>[] }
    expect(doc.keys).toHaveLength(2)
    expect(doc.keys.map((k) => k.kid)).toEqual(rotated.kids)
    for (const key of doc.keys) {
      for (const member of PRIVATE_MEMBERS) expect(key).not.toHaveProperty(member)
    }

    // Both halves still verify their own tokens against the rotated set.
    const ecMaterial = resolveKeyMaterial(EC_SOURCE, 'jwk')
    const ecKey = await privateKeyFromPem(fixture('ec-p256.pkcs8.key'), 'ES256')
    const ecToken = await signJwt({ sub: 'new-key' }, ecKey, 'ES256', {
      kid: ecMaterial.publicJwk?.kid,
    })
    expect((await verifyJwtWithJwks(ecToken, doc as never, ['ES256'])).payload.sub).toBe('new-key')

    const rsaMaterial = resolveKeyMaterial(RSA_SOURCE, 'jwk')
    const rsaKey = await privateKeyFromPem(fixture('client.pkcs8.key'), 'RS256')
    const rsaToken = await signJwt({ sub: 'old-key' }, rsaKey, 'RS256', {
      kid: rsaMaterial.publicJwk?.kid,
    })
    expect((await verifyJwtWithJwks(rsaToken, doc as never, ['RS256'])).payload.sub).toBe('old-key')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 4. D1-3 — base path is stripped BEFORE matching
// ═══════════════════════════════════════════════════════════════════════════

describe('base path (D1-3)', () => {
  it('the SAME stored post-strip path is served at base + path when a base path is set', async () => {
    const basedPort = await freePort()
    const projectId = seedProject(testDb, seedWorkspace(testDb, 'WS2'), 'P2')
    const server = await invoke<{ id: string }>('mock:server:create', {
      projectId,
      name: 'Based',
      port: basedPort,
      basePath: '/auth',
    })
    const endpoint = await invoke<{ id: string }>('mock:endpoint:create', {
      serverId: server.id,
      method: 'GET',
      // Stored POST-strip — NOT '/auth/.well-known/jwks.json'.
      path: '/.well-known/jwks.json',
      pathMode: 'exact',
    })
    const built = await invoke<{ body: string }>('jwks:build', { sources: [RSA_SOURCE] })
    await invoke('mock:response:create', {
      endpointId: endpoint.id,
      statusCode: 200,
      bodyType: 'json',
      body: built.body,
      condition: { type: 'always' },
    })

    // The MISTAKE D1-3 warns about, made deliberately on a second path: storing
    // the base-path prefix in the endpoint row. The prefix is stripped before
    // matching, so such a row can never be reached.
    const naive = await invoke<{ id: string }>('mock:endpoint:create', {
      serverId: server.id,
      method: 'GET',
      path: '/auth/naive.json',
      pathMode: 'exact',
    })
    await invoke('mock:response:create', {
      endpointId: naive.id,
      statusCode: 200,
      bodyType: 'json',
      body: '{}',
      condition: { type: 'always' },
    })

    await invoke('mock:server:start', server.id)

    try {
      // Effective URL = base + stored path.
      const based = await httpGet(`http://127.0.0.1:${basedPort}/auth/.well-known/jwks.json`)
      expect(based.status).toBe(200)
      expect((JSON.parse(based.body) as { keys: unknown[] }).keys).toHaveLength(1)

      // …and the prefix-in-the-row version is unreachable at its own URL.
      const unreachable = await httpGet(`http://127.0.0.1:${basedPort}/auth/naive.json`)
      expect(unreachable.status).toBe(404)
    } finally {
      await mockServerManager.stop(server.id)
    }
  }, 20000)
})
