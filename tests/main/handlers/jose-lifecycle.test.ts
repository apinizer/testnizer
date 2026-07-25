/**
 * `jose:*` IPC — the surfaces #63 ADDED on top of the landed sign/verify core.
 *
 * The sibling `jose.test.ts` pins the core contract (inline sign→verify,
 * keystore no-leak, RSA-OAEP JWE). This file pins what the full lifecycle added,
 * and only through the IPC boundary — the shape a renderer actually sees:
 *
 *  - CLAIMS      — aud/iss/clock-skew/"as of" travel through the envelope and
 *                  really change the verdict. `currentDate` crosses as epoch ms
 *                  (an IPC payload cannot carry a `Date`), so the conversion is
 *                  worth pinning on its own.
 *  - JWKS URL    — the fetch happens in MAIN because the renderer's CSP
 *                  (`connect-src 'self'`) forbids it. Verified hermetically
 *                  against an ephemeral `node:http` server, including that the
 *                  algorithm allowlist still refuses an HS256 forgery.
 *  - PUBLIC-ONLY — `jose:fetchJwks` strips every private JWK member. The URL is
 *                  user-supplied, so the guard cannot rest on the server being
 *                  well-behaved; the test serves a deliberately poisoned set.
 *  - SYMMETRIC   — `dir` / `A256KW` / PBES2 JWE take a shared secret. Before the
 *                  lifecycle work the handler asked `isHmacAlg`, which knows
 *                  only HS*, and would have demanded a certificate for `dir`.
 *  - NO-LEAK     — a keystore-backed sign still returns a token and nothing
 *                  else, re-asserted against the ADDED code paths.
 */

// reflect-metadata MUST load before @peculiar/x509 (see keystore.ts header).
import 'reflect-metadata'
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import { X509Certificate, createPrivateKey, generateKeyPairSync, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setupHandlerHarness, makeElectronMock, createTestDb } from './helpers'

const harness = setupHandlerHarness()
vi.mock('electron', () => makeElectronMock())

let testDb: ReturnType<typeof createTestDb>
vi.mock('../../../src/main/db/database', () => ({
  getDb: () => testDb,
}))

const { registerJoseHandlers } = await import('../../../src/main/ipc/jose.handler')
const { createKeystore } = await import('../../../src/main/db/keystore.repo')
const { signJwt, secretKey } = await import('../../../src/main/lib/jose-runtime')
const { resolveKeyMaterial } = await import('../../../src/main/lib/keystore-bridge')

const CERTS = join(dirname(fileURLToPath(import.meta.url)), '../../fixtures/certs')
const fixture = (f: string): string => readFileSync(join(CERTS, f), 'utf8')
const STORE_PW = 'testpassword'

/** Fixed instant — nothing here races the wall clock. */
const NOW_SECONDS = 1_700_000_000
const NOW_MS = NOW_SECONDS * 1000

interface Envelope<T> {
  success: boolean
  data?: T
  error?: string
}

interface VerifyOut {
  payload: Record<string, unknown>
  header: Record<string, unknown>
}

const servers: Server[] = []
afterAll(() => {
  for (const s of servers) s.close()
})

async function serveJson(body: unknown): Promise<string> {
  const server = createServer((_req, res) => {
    res.setHeader('content-type', 'application/json')
    res.end(typeof body === 'string' ? body : JSON.stringify(body))
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as { port: number }
  return `http://127.0.0.1:${port}/.well-known/jwks.json`
}

beforeEach(() => {
  testDb = createTestDb()
  harness.reset()
  registerJoseHandlers()
})

function seedKeystore(): string {
  const bytes = readFileSync(join(CERTS, 'client.jks'))
  return createKeystore({
    name: 'client.jks',
    type: 'JKS',
    blob: bytes.toString('base64'),
    store_password: STORE_PW,
    size_bytes: bytes.length,
  }).id
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. Claim checks across the bridge
// ═══════════════════════════════════════════════════════════════════════════

describe('jose:verify — opt-in claim checks', () => {
  const SECRET = 'a-shared-secret-that-is-at-least-256-bits-long!!'

  async function sign(claims: Record<string, unknown>): Promise<string> {
    const res = (await harness.invoke('jose:sign', {
      mode: 'jwt',
      alg: 'HS256',
      payload: claims,
      key: { inline: { secret: SECRET } },
    })) as Envelope<string>
    expect(res.success).toBe(true)
    return res.data as string
  }

  const verify = (token: string, claims: Record<string, unknown>): Promise<Envelope<VerifyOut>> =>
    harness.invoke('jose:verify', {
      mode: 'jwt',
      token,
      algorithms: ['HS256'],
      key: { inline: { secret: SECRET } },
      claims,
    }) as Promise<Envelope<VerifyOut>>

  it('evaluates exp against the supplied currentDate, not the wall clock', async () => {
    const token = await sign({ sub: 'x', exp: NOW_SECONDS - 60 })

    const expired = await verify(token, { currentDate: NOW_MS })
    expect(expired.success).toBe(false)
    expect(expired.error).toBeTruthy()

    const earlier = await verify(token, { currentDate: (NOW_SECONDS - 600) * 1000 })
    expect(earlier.success).toBe(true)
    expect(earlier.data?.payload.sub).toBe('x')
  })

  it('honours clockTolerance on both sides of the window', async () => {
    const token = await sign({ sub: 'x', exp: NOW_SECONDS - 30 })
    expect((await verify(token, { currentDate: NOW_MS, clockTolerance: 60 })).success).toBe(true)
    expect((await verify(token, { currentDate: NOW_MS, clockTolerance: 5 })).success).toBe(false)
  })

  it('rejects a not-yet-valid token until nbf passes', async () => {
    const token = await sign({ sub: 'x', nbf: NOW_SECONDS + 3600 })
    expect((await verify(token, { currentDate: NOW_MS })).success).toBe(false)
    expect((await verify(token, { currentDate: (NOW_SECONDS + 7200) * 1000 })).success).toBe(true)
  })

  it('checks aud and iss only when asked to', async () => {
    const token = await sign({ sub: 'x', aud: 'api://payments', iss: 'https://idp.example.com' })

    // No claim checks at all ⇒ neither is validated.
    expect((await verify(token, { currentDate: NOW_MS })).success).toBe(true)

    expect((await verify(token, { currentDate: NOW_MS, audience: 'api://payments' })).success).toBe(
      true,
    )
    expect((await verify(token, { currentDate: NOW_MS, audience: 'api://other' })).success).toBe(
      false,
    )
    expect(
      (await verify(token, { currentDate: NOW_MS, issuer: 'https://evil.example.com' })).success,
    ).toBe(false)
  })

  it('rejects a too-old iat under maxTokenAge', async () => {
    const token = await sign({ sub: 'x', iat: NOW_SECONDS - 7200 })
    expect((await verify(token, { currentDate: NOW_MS, maxTokenAge: '1h' })).success).toBe(false)
    expect((await verify(token, { currentDate: NOW_MS, maxTokenAge: '3h' })).success).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 2. JWKS over HTTP — fetched by MAIN
// ═══════════════════════════════════════════════════════════════════════════

describe('jose:verify with a JWKS URL, and jose:fetchJwks', () => {
  const rsaPrivate = createPrivateKey(fixture('client.pkcs8.key'))
  const rsaPublic = new X509Certificate(fixture('client.crt')).publicKey

  function publicJwk(kid: string): JsonWebKey & { kid: string } {
    return { ...(rsaPublic.export({ format: 'jwk' }) as JsonWebKey), kid, alg: 'RS256' }
  }

  it('fetches the set, selects by kid and verifies', async () => {
    const uri = await serveJson({ keys: [publicJwk('served')] })
    const token = await signJwt({ sub: 'remote' }, rsaPrivate as never, 'RS256', { kid: 'served' })

    const res = (await harness.invoke('jose:verify', {
      mode: 'jwt',
      token,
      algorithms: ['RS256'],
      jwksUri: uri,
      claims: { currentDate: NOW_MS },
    })) as Envelope<VerifyOut>

    expect(res.success).toBe(true)
    expect(res.data?.payload.sub).toBe('remote')
    expect(res.data?.header.kid).toBe('served')
  })

  it('refuses an HS256 forgery signed with the published public key', async () => {
    const jwk = publicJwk('served')
    const uri = await serveJson({ keys: [jwk] })
    const forged = await signJwt({ admin: true }, secretKey(JSON.stringify(jwk)), 'HS256', {
      kid: 'served',
    })

    const res = (await harness.invoke('jose:verify', {
      mode: 'jwt',
      token: forged,
      algorithms: ['RS256'],
      jwksUri: uri,
      claims: { currentDate: NOW_MS },
    })) as Envelope<VerifyOut>
    expect(res.success).toBe(false)
    expect(res.error).toBeTruthy()
  })

  it('rejects a kid the set does not carry', async () => {
    const uri = await serveJson({ keys: [publicJwk('served')] })
    const token = await signJwt({ sub: 'x' }, rsaPrivate as never, 'RS256', { kid: 'rotated-away' })

    const res = (await harness.invoke('jose:verify', {
      mode: 'jwt',
      token,
      algorithms: ['RS256'],
      jwksUri: uri,
      claims: { currentDate: NOW_MS },
    })) as Envelope<VerifyOut>
    expect(res.success).toBe(false)
  })

  it('PUBLIC-ONLY: fetchJwks strips every private member from a poisoned set', async () => {
    // A misconfigured endpoint really can serve private keys. The strip must
    // not depend on the server being well-behaved.
    const poisoned = {
      keys: [
        {
          ...publicJwk('leaky'),
          d: 'PRIVATE-EXPONENT',
          p: 'PRIME-P',
          q: 'PRIME-Q',
          dp: 'DP',
          dq: 'DQ',
          qi: 'QI',
          oth: [{ r: 'R', d: 'D', t: 'T' }],
        },
        { kty: 'oct', kid: 'symmetric', k: 'RAW-SECRET-MATERIAL' },
      ],
    }
    const uri = await serveJson(poisoned)

    const res = (await harness.invoke('jose:fetchJwks', uri)) as Envelope<{ keys: JsonWebKey[] }>
    expect(res.success).toBe(true)
    expect(res.data?.keys).toHaveLength(2)

    for (const key of res.data!.keys) {
      for (const member of ['d', 'p', 'q', 'dp', 'dq', 'qi', 'k', 'oth']) {
        expect(key).not.toHaveProperty(member)
      }
    }
    // The public members survive — a stripped set is still usable for verify.
    expect(res.data?.keys[0].kid).toBe('leaky')
    expect(res.data?.keys[0].n).toBeTruthy()

    const wire = JSON.stringify(res)
    expect(wire).not.toContain('PRIVATE-EXPONENT')
    expect(wire).not.toContain('PRIME-P')
    expect(wire).not.toContain('RAW-SECRET-MATERIAL')
  })

  it('fails loud on a non-http scheme and on a body that is not a JWKS', async () => {
    const scheme = (await harness.invoke('jose:fetchJwks', 'file:///etc/passwd')) as Envelope<never>
    expect(scheme.success).toBe(false)
    expect(scheme.error).toMatch(/http/i)

    const notASet = await serveJson({ hello: 'world' })
    const res = (await harness.invoke('jose:fetchJwks', notASet)) as Envelope<never>
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/JWKS/i)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 3. Symmetric JWE — the family `isHmacAlg` cannot classify
// ═══════════════════════════════════════════════════════════════════════════

describe('jose:encrypt → jose:decrypt with shared-secret algorithms', () => {
  const cek32 = randomBytes(32).toString('base64').slice(0, 32)

  it.each([
    ['dir', 'A256GCM'],
    ['A256KW', 'A256GCM'],
    ['PBES2-HS256+A128KW', 'A128GCM'],
  ])('%s / %s round-trips with a pasted secret', async (alg, enc) => {
    const encrypted = (await harness.invoke('jose:encrypt', {
      alg,
      enc,
      plaintext: 'symmetric payload',
      key: { inline: { secret: cek32 } },
    })) as Envelope<string>
    expect(encrypted.success).toBe(true)
    expect((encrypted.data as string).split('.')).toHaveLength(5)

    const decrypted = (await harness.invoke('jose:decrypt', {
      alg,
      enc,
      jwe: encrypted.data,
      key: { inline: { secret: cek32 } },
    })) as Envelope<{ plaintext: string }>
    expect(decrypted.success).toBe(true)
    expect(decrypted.data?.plaintext).toBe('symmetric payload')
  })

  it('a wrong secret fails to decrypt', async () => {
    const encrypted = (await harness.invoke('jose:encrypt', {
      alg: 'dir',
      enc: 'A256GCM',
      plaintext: 'x',
      key: { inline: { secret: cek32 } },
    })) as Envelope<string>

    const decrypted = (await harness.invoke('jose:decrypt', {
      alg: 'dir',
      enc: 'A256GCM',
      jwe: encrypted.data,
      key: { inline: { secret: 'a-different-32-byte-secret-value' } },
    })) as Envelope<unknown>
    expect(decrypted.success).toBe(false)
  })

  it('refuses a keystore source for a shared-secret algorithm', async () => {
    const keystoreId = seedKeystore()
    const res = (await harness.invoke('jose:encrypt', {
      alg: 'dir',
      enc: 'A256GCM',
      plaintext: 'x',
      key: { source: { kind: 'keystore', keystoreId, alias: 'test-client' } },
    })) as Envelope<unknown>
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/shared-secret algorithm/)
  })

  it('says which half is missing instead of failing obscurely', async () => {
    const noPublic = (await harness.invoke('jose:encrypt', {
      alg: 'RSA-OAEP-256',
      enc: 'A256GCM',
      plaintext: 'x',
      key: { inline: {} },
    })) as Envelope<unknown>
    expect(noPublic.success).toBe(false)
    expect(noPublic.error).toMatch(/to encrypt/)

    const noPrivate = (await harness.invoke('jose:decrypt', {
      alg: 'RSA-OAEP-256',
      enc: 'A256GCM',
      jwe: 'a.b.c.d.e',
      key: { inline: {} },
    })) as Envelope<unknown>
    expect(noPrivate.success).toBe(false)
    expect(noPrivate.error).toMatch(/to decrypt/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 4. NO-LEAK, re-asserted against the added paths
// ═══════════════════════════════════════════════════════════════════════════

describe('a keystore-backed operation never returns key material', () => {
  it('sign returns ONLY the token, and that token verifies against the alias JWKS', async () => {
    const keystoreId = seedKeystore()
    const source = { kind: 'keystore' as const, keystoreId, alias: 'test-client' }

    // The relying party's view of this alias: its PUBLIC JWK, resolved the same
    // way a JWKS publisher would (`need:'jwk'` strips every private member).
    const publicJwk = resolveKeyMaterial(source, 'jwk').publicJwk!
    expect(publicJwk).toBeTruthy()

    const signed = (await harness.invoke('jose:sign', {
      mode: 'jwt',
      alg: 'RS256',
      payload: { sub: 'svc', exp: NOW_SECONDS + 3600 },
      header: { kid: publicJwk.kid },
      key: { source },
    })) as Envelope<string>

    expect(signed.success).toBe(true)
    expect(Object.keys(signed).sort()).toEqual(['data', 'success'])
    expect(typeof signed.data).toBe('string')

    const wire = JSON.stringify(signed)
    expect(wire).not.toContain('PRIVATE KEY')
    expect(wire).not.toContain('BEGIN CERTIFICATE')
    expect(wire).not.toContain(STORE_PW)

    // Serve the PUBLIC jwk and verify the token the same way a relying party
    // would — proving the signature is real, not that the handler shrugged.
    const uri = await serveJson({ keys: [publicJwk] })
    const verified = (await harness.invoke('jose:verify', {
      mode: 'jwt',
      token: signed.data,
      algorithms: ['RS256'],
      jwksUri: uri,
      claims: { currentDate: NOW_MS },
    })) as Envelope<VerifyOut>
    expect(verified.success).toBe(true)
    expect(verified.data?.payload.sub).toBe('svc')
  })

  it('a wrong store password fails loud rather than returning an unsigned token', async () => {
    const bytes = readFileSync(join(CERTS, 'client.jks'))
    const keystoreId = createKeystore({
      name: 'nopw.jks',
      type: 'JKS',
      blob: bytes.toString('base64'),
      size_bytes: bytes.length,
    }).id

    const res = (await harness.invoke('jose:sign', {
      mode: 'jwt',
      alg: 'RS256',
      payload: { sub: 'x' },
      key: {
        source: { kind: 'keystore', keystoreId, alias: 'test-client', storePassword: 'WRONG' },
      },
    })) as Envelope<unknown>

    expect(res.success).toBe(false)
    expect(res.error).toBeTruthy()
    expect(res.data).toBeUndefined()
    expect(JSON.stringify(res)).not.toContain('PRIVATE KEY')
  })

  it('an ephemeral key the USER generated is theirs — the inline arm still works', async () => {
    // The no-leak rule is about PROVIDER-backed material. A pasted key stays a
    // first-class path: this is the additive invariant, asserted not assumed.
    const { privateKey, publicKey } = generateKeyPairSync('ed25519')
    const signed = (await harness.invoke('jose:sign', {
      mode: 'jwt',
      alg: 'EdDSA',
      payload: { sub: 'pasted' },
      key: {
        inline: { privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string },
      },
    })) as Envelope<string>
    expect(signed.success).toBe(true)

    const verified = (await harness.invoke('jose:verify', {
      mode: 'jwt',
      token: signed.data,
      alg: 'EdDSA',
      algorithms: ['EdDSA'],
      key: {
        inline: { certPem: publicKey.export({ type: 'spki', format: 'pem' }) as string },
      },
    })) as Envelope<VerifyOut>
    expect(verified.success).toBe(true)
    expect(verified.data?.payload.sub).toBe('pasted')
  })
})
