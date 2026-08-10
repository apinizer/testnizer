/**
 * JWKS builder (#61 / Faz D1) — `buildJwks` is the ONE place a publishable
 * `{keys:[…]}` document is assembled, so every D1 invariant is pinned here:
 *
 *  - PUBLIC-JWK-ONLY (D1-4, HARD) — a deliberately PRIVATE JWK fed in comes out
 *    with no `d,p,q,dp,dq,qi,k` (nor RSA multi-prime `oth`); a symmetric `oct`
 *    key is refused outright rather than published as a stripped husk.
 *  - STABLE — de-duplicated by `kid`, deterministic member order, so a rebuilt
 *    body is byte-identical and a rewritten mock response does not churn.
 *  - INTEROP — a set built from `resolveKeyMaterial(…, 'jwk').publicJwk` is
 *    accepted by jose's `createLocalJWKSet` and actually verifies a token signed
 *    with the matching private half.
 *
 * The interop assertion goes through `jose-runtime.ts` (`verifyJwtWithJwks`
 * wraps `createLocalJWKSet`) rather than importing `jose` directly — the same
 * single-door rule main-side code follows.
 */

// reflect-metadata MUST load before @peculiar/x509 (keystore.ts pulls it in).
import 'reflect-metadata'
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateKeyPairSync } from 'node:crypto'

// keystore-bridge → secure-storage → electron. Stub it; the inline arm used
// here never touches the DB.
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string): Buffer => Buffer.from(s),
    decryptString: (b: Buffer): string => b.toString('utf8'),
  },
}))

const { buildJwks, serializeJwks, JwksError } = await import('../../src/main/lib/jwks')
const { resolveKeyMaterial } = await import('../../src/main/lib/keystore-bridge')
const { privateKeyFromPem, signJwt, verifyJwtWithJwks } =
  await import('../../src/main/lib/jose-runtime')

const CERTS = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/certs')
const fixture = (f: string): string => readFileSync(join(CERTS, f), 'utf8')

const PRIVATE_MEMBERS = ['d', 'p', 'q', 'dp', 'dq', 'qi', 'k'] as const

// ═══════════════════════════════════════════════════════════════════════════
// 1. PUBLIC-JWK-ONLY (D1-4) — the hard requirement
// ═══════════════════════════════════════════════════════════════════════════

describe('buildJwks — public-JWK-only (D1-4)', () => {
  it('strips EVERY private member from a deliberately PRIVATE RSA JWK', () => {
    // A full private JWK — exactly the mistake the defensive strip exists for.
    const priv = resolveKeyMaterial(
      { kind: 'inline', certPem: fixture('client.crt'), keyPem: fixture('client.pkcs8.key') },
      'jwk',
    ).privateJwk!
    // Sanity: the input really IS private, otherwise this test proves nothing.
    expect(priv).toHaveProperty('d')
    expect(priv).toHaveProperty('p')
    expect(priv).toHaveProperty('q')

    const jwks = buildJwks({ keys: [priv] })
    expect(jwks.keys).toHaveLength(1)
    for (const member of PRIVATE_MEMBERS) {
      expect(jwks.keys[0]).not.toHaveProperty(member)
    }
    // The public half survives intact — a stripped key is still usable.
    expect(jwks.keys[0].kty).toBe('RSA')
    expect(jwks.keys[0].n).toBe(priv.n)
    expect(jwks.keys[0].e).toBe(priv.e)
    expect(jwks.keys[0].kid).toBe(priv.kid)

    // …and nothing private survives the SERIALIZED body either (the body is
    // what actually gets served, so assert on the text too).
    const body = serializeJwks(jwks)
    for (const member of PRIVATE_MEMBERS) {
      expect(body).not.toContain(`"${member}"`)
    }
    expect(body).not.toContain(String(priv.d))
  })

  it('strips private members from a private EC JWK too', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    const m = resolveKeyMaterial(
      {
        kind: 'inline',
        certPem: publicKey.export({ type: 'spki', format: 'pem' }) as string,
        keyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
      },
      'jwk',
    )
    expect(m.privateJwk).toHaveProperty('d')
    const jwks = buildJwks({ keys: [m.privateJwk!] })
    expect(jwks.keys[0]).not.toHaveProperty('d')
    expect(jwks.keys[0].crv).toBe('P-256')
    expect(jwks.keys[0].x).toBeTruthy()
    expect(jwks.keys[0].y).toBeTruthy()
  })

  it('strips RSA multi-prime `oth` (private "other primes info") as well', () => {
    const jwks = buildJwks({
      keys: [
        {
          kty: 'RSA',
          n: 'AAAA',
          e: 'AQAB',
          d: 'secret',
          oth: [{ r: 'r', d: 'd', t: 't' }],
        } as unknown as JsonWebKey,
      ],
    })
    expect(jwks.keys[0]).not.toHaveProperty('oth')
    expect(jwks.keys[0]).not.toHaveProperty('d')
  })

  it('REFUSES a symmetric (oct) key — a shared secret has no publishable half', () => {
    expect(() =>
      buildJwks({ keys: [{ kty: 'oct', k: 'c3VwZXItc2VjcmV0', kid: 'hs' } as JsonWebKey] }),
    ).toThrow(JwksError)
    expect(() => buildJwks({ keys: [{ kty: 'oct', k: 'x' } as JsonWebKey] })).toThrow(
      /must never be published/,
    )
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 2. De-duplication + stability
// ═══════════════════════════════════════════════════════════════════════════

describe('buildJwks — dedupe + stable order', () => {
  const a = { kty: 'RSA', n: 'AAAA', e: 'AQAB', kid: 'one' } as JsonWebKey
  const b = { kty: 'RSA', n: 'BBBB', e: 'AQAB', kid: 'two' } as JsonWebKey

  it('de-duplicates by kid, first occurrence wins', () => {
    const dupe = { kty: 'RSA', n: 'ZZZZ', e: 'AQAB', kid: 'one' } as JsonWebKey
    const jwks = buildJwks({ keys: [a, b, dupe] })
    expect(jwks.keys).toHaveLength(2)
    expect(jwks.keys.map((k) => k.kid)).toEqual(['one', 'two'])
    // FIRST wins: the later key with the same kid does not overwrite it.
    expect(jwks.keys[0].n).toBe('AAAA')
  })

  it('de-duplicates keyless-kid entries by content', () => {
    const noKid = { kty: 'RSA', n: 'CCCC', e: 'AQAB' } as JsonWebKey
    const jwks = buildJwks({ keys: [noKid, { ...noKid }] })
    expect(jwks.keys).toHaveLength(1)
  })

  it('preserves input order', () => {
    expect(buildJwks({ keys: [b, a] }).keys.map((k) => k.kid)).toEqual(['two', 'one'])
  })

  it('serializes byte-identically regardless of input member order (no churn)', () => {
    const one = serializeJwks(buildJwks({ keys: [{ kty: 'RSA', n: 'AAAA', e: 'AQAB', kid: 'k' }] }))
    const two = serializeJwks(buildJwks({ keys: [{ kid: 'k', e: 'AQAB', n: 'AAAA', kty: 'RSA' }] }))
    expect(one).toBe(two)
  })

  it('an empty set is valid', () => {
    expect(buildJwks({ keys: [] })).toEqual({ keys: [] })
    expect(serializeJwks(buildJwks({ keys: [] }))).toBe('{\n  "keys": []\n}')
  })

  it('FAILS LOUD on a malformed key rather than silently dropping it', () => {
    expect(() => buildJwks({ keys: [null as unknown as JsonWebKey] })).toThrow(JwksError)
    expect(() => buildJwks({ keys: [{ n: 'AAAA' } as JsonWebKey] })).toThrow(/no "kty"/)
    expect(() => buildJwks({ keys: undefined as never })).toThrow(/expects \{ keys/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 3. INTEROP — resolveKeyMaterial(…,'jwk').publicJwk → jose createLocalJWKSet
// ═══════════════════════════════════════════════════════════════════════════

describe('buildJwks — jose interop', () => {
  it("a set built from resolveKeyMaterial(…,'jwk').publicJwk verifies a real token", async () => {
    const material = resolveKeyMaterial(
      { kind: 'inline', certPem: fixture('client.crt'), keyPem: fixture('client.pkcs8.key') },
      'jwk',
    )
    const jwks = buildJwks({ keys: [material.publicJwk!] })

    const signingKey = await privateKeyFromPem(fixture('client.pkcs8.key'), 'RS256')
    const token = await signJwt({ sub: 'testnizer', iss: 'mock' }, signingKey, 'RS256', {
      kid: material.publicJwk!.kid,
    })

    // createLocalJWKSet (inside verifyJwtWithJwks) rejects a malformed set, so
    // this proves BOTH shape-acceptance and key selection by RFC 7638 kid.
    const res = await verifyJwtWithJwks(token, jwks as never, ['RS256'])
    expect(res.payload.sub).toBe('testnizer')
    expect(res.header.kid).toBe(material.publicJwk!.kid)
  })

  it('a two-key rotation set still selects the right key by kid', async () => {
    const rsa = resolveKeyMaterial(
      { kind: 'inline', certPem: fixture('client.crt'), keyPem: fixture('client.pkcs8.key') },
      'jwk',
    )
    const other = resolveKeyMaterial({ kind: 'inline', certPem: fixture('ca.crt') }, 'jwk')
    const jwks = buildJwks({ keys: [other.publicJwk!, rsa.publicJwk!] })
    expect(jwks.keys).toHaveLength(2)

    const signingKey = await privateKeyFromPem(fixture('client.pkcs8.key'), 'RS256')
    const token = await signJwt({ sub: 'rotated' }, signingKey, 'RS256', {
      kid: rsa.publicJwk!.kid,
    })
    const res = await verifyJwtWithJwks(token, jwks as never, ['RS256'])
    expect(res.payload.sub).toBe('rotated')
  })

  it('every key in a multi-source set is publishable (no private member anywhere)', () => {
    const keys = [
      resolveKeyMaterial(
        { kind: 'inline', certPem: fixture('client.crt'), keyPem: fixture('client.pkcs8.key') },
        'jwk',
      ).privateJwk!,
      resolveKeyMaterial(
        {
          kind: 'file',
          certPath: join(CERTS, 'ec-p256.crt'),
          keyPath: join(CERTS, 'ec-p256.pkcs8.key'),
        },
        'jwk',
      ).privateJwk!,
    ]
    const jwks = buildJwks({ keys })
    expect(jwks.keys).toHaveLength(2)
    for (const key of jwks.keys) {
      for (const member of PRIVATE_MEMBERS) expect(key).not.toHaveProperty(member)
    }
  })
})

describe('the private-member list has no second copy that can drift', () => {
  it('main and renderer strip exactly the same JWK members', async () => {
    // Two hand-synced copies of a security-critical constant is the parallelism
    // bug class CLAUDE.md documents for runner verdicts, header assertions and
    // env-var resolution. Pin them instead of hoping.
    const main = await import('../../src/main/lib/jwks')
    const renderer = await import('../../src/renderer/lib/tools/jwk')
    const rendererMembers =
      (renderer as unknown as { PRIVATE_JWK_MEMBERS?: readonly string[] }).PRIVATE_JWK_MEMBERS ??
      (renderer as unknown as { JWK_PRIVATE_MEMBERS?: readonly string[] }).JWK_PRIVATE_MEMBERS
    expect(rendererMembers, 'renderer must export its private-member list').toBeDefined()
    expect([...(rendererMembers as readonly string[])].sort()).toEqual(
      [...main.PRIVATE_JWK_MEMBERS].sort(),
    )
  })
})

describe('no main-process module imports electron-store statically', () => {
  it('every electron-store use stays a dynamic import', async () => {
    // electron-store@10 is ESM-only and stays EXTERNALIZED, so it is safe ONLY
    // because every call site is `await import(...)`. A future refactor to a
    // top-level import reinstates the v1.4.19 ERR_REQUIRE_ESM launch crash —
    // and the build stays green while the packaged app dies on load.
    const { readdirSync, readFileSync, statSync } = await import('node:fs')
    const { join } = await import('node:path')
    const root = join(__dirname, '../../src/main')
    const offenders: string[] = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (entry.name.endsWith('.ts') && statSync(full).isFile()) {
          const src = readFileSync(full, 'utf8')
          if (/^\s*import\s[^\n]*from\s+['"]electron-store['"]/m.test(src)) offenders.push(full)
        }
      }
    }
    walk(root)
    expect(offenders).toEqual([])
  })
})
