/**
 * `jose-runtime.ts` — the full JOSE lifecycle (#63) at engine level.
 *
 * What this file is for, in one line each:
 *
 *  - ROUND-TRIPS   — every signing family the tool offers (HS/RS/PS/ES/EdDSA)
 *                    signs and verifies with real key material, so a curve↔alg
 *                    or key-type hard-code cannot hide behind a single happy
 *                    RS256 test.
 *  - TAMPERING     — a flipped signature byte, a rewritten payload and an
 *                    `alg:'none'` token are each REJECTED. These are the three
 *                    ways a JWT debugger can lie to a user about a token being
 *                    trustworthy, so each gets its own assertion.
 *  - TIME          — exp/nbf/iat are checked against an INJECTED `currentDate`,
 *                    never the wall clock. Clock-skew tolerance is pinned in
 *                    both directions (inside → passes, outside → fails).
 *  - JWE           — encrypt→decrypt across the asymmetric, ECDH and symmetric
 *                    families, plus the negative that a tampered ciphertext
 *                    fails GCM authentication instead of returning garbage.
 *  - JWKS          — a pasted set AND a set fetched over HTTP (hermetic, from
 *                    an ephemeral `node:http` server) select the key by `kid`
 *                    and refuse an algorithm outside the allowlist.
 *
 * EdDSA note: shipped as Ed25519 through jose v6's `EdDSA` algorithm
 * identifier, which needs no dependency beyond node:crypto + the bundled jose.
 */
import { describe, it, expect, afterAll } from 'vitest'
import { createServer, type Server } from 'node:http'
import {
  X509Certificate,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
} from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  decodeToken,
  decryptJwe,
  encryptJwe,
  isSymmetricJweAlg,
  privateKeyFromPem,
  publicKeyFromPem,
  secretKey,
  signJws,
  signJwt,
  verifyJws,
  verifyJwt,
  verifyJwtWithJwks,
  verifyJwtWithJwksUri,
  type JoseKeyLike,
} from '../../src/main/lib/jose-runtime'

const CERTS = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/certs')
const fixture = (f: string): string => readFileSync(join(CERTS, f), 'utf8')

/** A fixed instant, so nothing in this file races the wall clock. */
const NOW_SECONDS = 1_700_000_000
const NOW_MS = NOW_SECONDS * 1000

const HS_SECRET = 'a-shared-secret-that-is-at-least-256-bits-long!!'

const rsaPrivate = createPrivateKey(fixture('client.pkcs8.key'))
const rsaPublic = new X509Certificate(fixture('client.crt')).publicKey
const otherRsa = generateKeyPairSync('rsa', { modulusLength: 2048 })
const p256Private = createPrivateKey(fixture('ec-p256.pkcs8.key'))
const p256Public = new X509Certificate(fixture('ec-p256.crt')).publicKey
const p384Private = createPrivateKey(fixture('ec-p384.pkcs8.key'))
const p384Public = new X509Certificate(fixture('ec-p384.crt')).publicKey
const p521 = generateKeyPairSync('ec', { namedCurve: 'secp521r1' })
const ed25519 = generateKeyPairSync('ed25519')

const servers: Server[] = []
afterAll(() => {
  for (const s of servers) s.close()
})

/**
 * `signJwt`/`verifyJwt` take jose key material. A node `KeyObject` satisfies
 * jose at runtime, and the cast keeps every case below readable — the point of
 * these tests is the algorithm matrix, not the key-import ceremony.
 */
const asKey = (k: unknown): JoseKeyLike => k as JoseKeyLike

/**
 * Corrupt one BYTE of a compact token's Nth segment.
 *
 * Deliberately not "change the last base64url character": the final character
 * of a base64url string can carry unused trailing bits, so flipping it may
 * decode to the identical bytes and the token would not actually be tampered
 * with — a test that passes or fails depending on the random key/IV. Decoding,
 * flipping a byte and re-encoding always changes the plaintext bytes.
 */
function flipSegmentByte(token: string, index: number): string {
  const parts = token.split('.')
  const bytes = Buffer.from(parts[index], 'base64url')
  bytes[0] ^= 0xff
  parts[index] = bytes.toString('base64url')
  return parts.join('.')
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. Sign → verify round-trip, per algorithm family
// ═══════════════════════════════════════════════════════════════════════════

describe('sign → verify round-trip across every offered algorithm', () => {
  it.each(['HS256', 'HS384', 'HS512'])('%s round-trips with a shared secret', async (alg) => {
    const token = await signJwt({ sub: 'alice', role: 'admin' }, secretKey(HS_SECRET), alg)
    expect(token.split('.')).toHaveLength(3)

    const res = await verifyJwt(token, secretKey(HS_SECRET), [alg], { currentDate: NOW_MS })
    expect(res.header.alg).toBe(alg)
    expect(res.payload.sub).toBe('alice')
    expect(res.payload.role).toBe('admin')
  })

  it.each(['RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512'])(
    '%s round-trips with the RSA fixture key pair',
    async (alg) => {
      const token = await signJwt({ sub: 'svc' }, asKey(rsaPrivate), alg)
      const res = await verifyJwt(token, asKey(rsaPublic), [alg], { currentDate: NOW_MS })
      expect(res.header.alg).toBe(alg)
      expect(res.payload.sub).toBe('svc')
    },
  )

  it('ES256 round-trips with the P-256 fixture', async () => {
    const token = await signJwt({ sub: 'ec-256' }, asKey(p256Private), 'ES256')
    const res = await verifyJwt(token, asKey(p256Public), ['ES256'], { currentDate: NOW_MS })
    expect(res.header.alg).toBe('ES256')
    expect(res.payload.sub).toBe('ec-256')
  })

  it('ES384 round-trips with the P-384 fixture — curve↔alg is not hard-coded', async () => {
    const token = await signJwt({ sub: 'ec-384' }, asKey(p384Private), 'ES384')
    const res = await verifyJwt(token, asKey(p384Public), ['ES384'], { currentDate: NOW_MS })
    expect(res.header.alg).toBe('ES384')
  })

  it('ES512 round-trips with a generated P-521 key', async () => {
    const token = await signJwt({ sub: 'ec-521' }, asKey(p521.privateKey), 'ES512')
    const res = await verifyJwt(token, asKey(p521.publicKey), ['ES512'], { currentDate: NOW_MS })
    expect(res.header.alg).toBe('ES512')
  })

  it('EdDSA (Ed25519) round-trips — no dependency beyond node:crypto + jose', async () => {
    const token = await signJwt({ sub: 'ed' }, asKey(ed25519.privateKey), 'EdDSA')
    const res = await verifyJwt(token, asKey(ed25519.publicKey), ['EdDSA'], { currentDate: NOW_MS })
    expect(res.header.alg).toBe('EdDSA')
    expect(res.payload.sub).toBe('ed')
  })

  it('accepts a PEM private key and a CERTIFICATE PEM to verify — what users paste', async () => {
    const key = await privateKeyFromPem(fixture('client.pkcs8.key'), 'RS256')
    const pub = await publicKeyFromPem(fixture('client.crt'), 'RS256')
    const token = await signJwt({ sub: 'pem' }, key, 'RS256')
    await expect(verifyJwt(token, pub, ['RS256'], { currentDate: NOW_MS })).resolves.toMatchObject({
      payload: { sub: 'pem' },
    })
  })

  it('signs and verifies an arbitrary payload as a compact JWS', async () => {
    const jws = await signJws('contract-body-v1', asKey(p256Private), 'ES256')
    const res = await verifyJws(jws, asKey(p256Public), ['ES256'])
    expect(res.payload).toBe('contract-body-v1')
    expect(res.header.alg).toBe('ES256')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 2. Tampering and key confusion — the ways a debugger could lie
// ═══════════════════════════════════════════════════════════════════════════

describe('tampering is always rejected', () => {
  it('a flipped signature byte fails verification', async () => {
    const token = await signJwt({ sub: 'x' }, asKey(rsaPrivate), 'RS256')
    await expect(
      verifyJwt(flipSegmentByte(token, 2), asKey(rsaPublic), ['RS256'], { currentDate: NOW_MS }),
    ).rejects.toThrow()
  })

  it('a rewritten payload with the original signature fails', async () => {
    const token = await signJwt({ sub: 'user', role: 'guest' }, secretKey(HS_SECRET), 'HS256')
    const parts = token.split('.')
    parts[1] = Buffer.from(JSON.stringify({ sub: 'user', role: 'admin' })).toString('base64url')

    await expect(
      verifyJwt(parts.join('.'), secretKey(HS_SECRET), ['HS256'], { currentDate: NOW_MS }),
    ).rejects.toThrow()
  })

  it("an alg:'none' token is never accepted", async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
    const body = Buffer.from(JSON.stringify({ sub: 'admin', role: 'root' })).toString('base64url')
    const unsecured = `${header}.${body}.`

    await expect(
      verifyJwt(unsecured, secretKey(HS_SECRET), ['HS256'], { currentDate: NOW_MS }),
    ).rejects.toThrow()
    await expect(
      verifyJwt(unsecured, asKey(rsaPublic), ['RS256'], { currentDate: NOW_MS }),
    ).rejects.toThrow()
  })

  it('RS↔HS algorithm confusion is refused by the allowlist', async () => {
    // The classic forgery: the attacker knows the PUBLIC key and signs an
    // HS256 token with it, hoping the verifier reads `alg` from the header.
    const publicPem = fixture('client.crt')
    const forged = await signJwt({ sub: 'attacker', admin: true }, secretKey(publicPem), 'HS256')

    await expect(
      verifyJwt(forged, asKey(createPublicKey(publicPem)), ['RS256'], { currentDate: NOW_MS }),
    ).rejects.toThrow()
  })

  it('a different public key fails — verification is key-bound', async () => {
    const token = await signJwt({ sub: 'x' }, asKey(rsaPrivate), 'RS256')
    await expect(
      verifyJwt(token, asKey(otherRsa.publicKey), ['RS256'], { currentDate: NOW_MS }),
    ).rejects.toThrow()
  })

  it('a wrong shared secret fails', async () => {
    const token = await signJwt({ sub: 'x' }, secretKey(HS_SECRET), 'HS256')
    await expect(
      verifyJwt(token, secretKey('a-completely-different-secret-value!!!!'), ['HS256'], {
        currentDate: NOW_MS,
      }),
    ).rejects.toThrow()
  })

  it('a key that does not match the algorithm refuses to sign', async () => {
    await expect(signJwt({ sub: 'x' }, asKey(rsaPrivate), 'ES256')).rejects.toThrow()
    await expect(signJwt({ sub: 'x' }, asKey(p256Private), 'RS256')).rejects.toThrow()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 3. Time and claim checks — evaluated against an injected instant
// ═══════════════════════════════════════════════════════════════════════════

describe('expiry, not-before and the opt-in claim checks', () => {
  const signAt = (claims: Record<string, unknown>): Promise<string> =>
    signJwt(claims, secretKey(HS_SECRET), 'HS256')

  it('an expired token is rejected', async () => {
    const token = await signAt({ sub: 'x', exp: NOW_SECONDS - 60 })
    await expect(
      verifyJwt(token, secretKey(HS_SECRET), ['HS256'], { currentDate: NOW_MS }),
    ).rejects.toThrow()
  })

  it('the SAME token verifies at an instant before it expired', async () => {
    const token = await signAt({ sub: 'x', exp: NOW_SECONDS - 60 })
    const res = await verifyJwt(token, secretKey(HS_SECRET), ['HS256'], {
      currentDate: (NOW_SECONDS - 600) * 1000,
    })
    expect(res.payload.sub).toBe('x')
  })

  it('clock tolerance forgives skew inside the window and not outside it', async () => {
    const token = await signAt({ sub: 'x', exp: NOW_SECONDS - 30 })

    await expect(
      verifyJwt(token, secretKey(HS_SECRET), ['HS256'], {
        currentDate: NOW_MS,
        clockTolerance: 60,
      }),
    ).resolves.toMatchObject({ payload: { sub: 'x' } })

    await expect(
      verifyJwt(token, secretKey(HS_SECRET), ['HS256'], {
        currentDate: NOW_MS,
        clockTolerance: 10,
      }),
    ).rejects.toThrow()
  })

  it('a not-yet-valid token (nbf in the future) is rejected until nbf passes', async () => {
    const token = await signAt({ sub: 'x', nbf: NOW_SECONDS + 3600 })

    await expect(
      verifyJwt(token, secretKey(HS_SECRET), ['HS256'], { currentDate: NOW_MS }),
    ).rejects.toThrow()

    await expect(
      verifyJwt(token, secretKey(HS_SECRET), ['HS256'], {
        currentDate: (NOW_SECONDS + 7200) * 1000,
      }),
    ).resolves.toMatchObject({ payload: { sub: 'x' } })
  })

  it('audience is enforced ONLY when asked for', async () => {
    const token = await signAt({ sub: 'x', aud: 'api://payments' })

    // Not asked for ⇒ not checked. Enforcement is opt-in on purpose.
    await expect(
      verifyJwt(token, secretKey(HS_SECRET), ['HS256'], { currentDate: NOW_MS }),
    ).resolves.toMatchObject({ payload: { sub: 'x' } })

    await expect(
      verifyJwt(token, secretKey(HS_SECRET), ['HS256'], {
        currentDate: NOW_MS,
        audience: 'api://payments',
      }),
    ).resolves.toMatchObject({ payload: { sub: 'x' } })

    await expect(
      verifyJwt(token, secretKey(HS_SECRET), ['HS256'], {
        currentDate: NOW_MS,
        audience: 'api://other',
      }),
    ).rejects.toThrow()
  })

  it('issuer is enforced when asked for', async () => {
    const token = await signAt({ sub: 'x', iss: 'https://idp.example.com' })
    await expect(
      verifyJwt(token, secretKey(HS_SECRET), ['HS256'], {
        currentDate: NOW_MS,
        issuer: 'https://idp.example.com',
      }),
    ).resolves.toBeTruthy()
    await expect(
      verifyJwt(token, secretKey(HS_SECRET), ['HS256'], {
        currentDate: NOW_MS,
        issuer: 'https://evil.example.com',
      }),
    ).rejects.toThrow()
  })

  it('maxTokenAge rejects a too-old iat', async () => {
    const token = await signAt({ sub: 'x', iat: NOW_SECONDS - 7200 })
    await expect(
      verifyJwt(token, secretKey(HS_SECRET), ['HS256'], {
        currentDate: NOW_MS,
        maxTokenAge: '1h',
      }),
    ).rejects.toThrow()
    await expect(
      verifyJwt(token, secretKey(HS_SECRET), ['HS256'], {
        currentDate: NOW_MS,
        maxTokenAge: '3h',
      }),
    ).resolves.toBeTruthy()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 4. JWE
// ═══════════════════════════════════════════════════════════════════════════

describe('JWE encrypt → decrypt', () => {
  it('classifies the symmetric key-management families', () => {
    for (const alg of ['dir', 'A128KW', 'A256KW', 'A256GCMKW', 'PBES2-HS256+A128KW']) {
      expect(isSymmetricJweAlg(alg)).toBe(true)
    }
    for (const alg of ['RSA-OAEP', 'RSA-OAEP-256', 'ECDH-ES', 'ECDH-ES+A256KW']) {
      expect(isSymmetricJweAlg(alg)).toBe(false)
    }
  })

  it.each([
    ['RSA-OAEP', 'A256GCM'],
    ['RSA-OAEP-256', 'A128CBC-HS256'],
  ])('%s / %s round-trips with the RSA fixture', async (alg, enc) => {
    const jwe = await encryptJwe('{"card":"4111111111111111"}', asKey(rsaPublic), alg, enc)
    expect(jwe.split('.')).toHaveLength(5)

    const res = await decryptJwe(jwe, asKey(rsaPrivate))
    expect(res.plaintext).toBe('{"card":"4111111111111111"}')
    expect(res.header.alg).toBe(alg)
    expect(res.header.enc).toBe(enc)
  })

  it('ECDH-ES / A128GCM round-trips with EC keys and carries an ephemeral epk', async () => {
    const jwe = await encryptJwe('ecdh secret', asKey(p256Public), 'ECDH-ES', 'A128GCM')
    const res = await decryptJwe(jwe, asKey(p256Private))
    expect(res.plaintext).toBe('ecdh secret')
    expect(res.header.epk).toBeTruthy()
  })

  it('dir / A256GCM round-trips with a 32-byte content-encryption key', async () => {
    const cek = new Uint8Array(randomBytes(32))
    const jwe = await encryptJwe('direct secret', cek, 'dir', 'A256GCM')
    // `dir` uses the key as-is, so the encrypted-key segment is empty.
    expect(jwe.split('.')[1]).toBe('')
    await expect(decryptJwe(jwe, cek)).resolves.toMatchObject({ plaintext: 'direct secret' })
  })

  it('dir with a wrong-size key is refused rather than silently truncated', async () => {
    const tooShort = new Uint8Array(randomBytes(16))
    await expect(encryptJwe('x', tooShort, 'dir', 'A256GCM')).rejects.toThrow()
  })

  it('A256KW / A256GCM round-trips with a symmetric wrapping key', async () => {
    const kek = new Uint8Array(randomBytes(32))
    const jwe = await encryptJwe('wrapped', kek, 'A256KW', 'A256GCM')
    await expect(decryptJwe(jwe, kek)).resolves.toMatchObject({ plaintext: 'wrapped' })
  })

  it('PBES2 round-trips only when the key-management algorithm is PINNED', async () => {
    const password = secretKey('correct horse battery staple')
    const jwe = await encryptJwe('pbes2', password, 'PBES2-HS256+A128KW', 'A128GCM')

    // Without an explicit allowlist jose refuses PBES2 outright — an
    // attacker-chosen `p2c` iteration count is a denial-of-service vector. The
    // handler always passes the caller's `alg`, so this is a documented pin,
    // not an accident.
    await expect(decryptJwe(jwe, password)).rejects.toThrow()

    await expect(decryptJwe(jwe, password, ['PBES2-HS256+A128KW'])).resolves.toMatchObject({
      plaintext: 'pbes2',
    })
  })

  it('the pin blocks algorithm substitution: a mismatched allowlist refuses', async () => {
    const jwe = await encryptJwe('secret', asKey(rsaPublic), 'RSA-OAEP-256', 'A256GCM')
    await expect(decryptJwe(jwe, asKey(rsaPrivate), ['RSA-OAEP'])).rejects.toThrow()
    await expect(decryptJwe(jwe, asKey(rsaPrivate), ['RSA-OAEP-256'])).resolves.toMatchObject({
      plaintext: 'secret',
    })
  })

  it('the wrong private key cannot decrypt', async () => {
    const jwe = await encryptJwe('secret', asKey(rsaPublic), 'RSA-OAEP-256', 'A256GCM')
    await expect(decryptJwe(jwe, asKey(otherRsa.privateKey))).rejects.toThrow()
  })

  it('a tampered ciphertext or auth tag fails GCM authentication', async () => {
    const jwe = await encryptJwe('balance:1000', asKey(rsaPublic), 'RSA-OAEP-256', 'A256GCM')
    // Segment 3 is the ciphertext, 4 the authentication tag.
    await expect(decryptJwe(flipSegmentByte(jwe, 3), asKey(rsaPrivate))).rejects.toThrow()
    await expect(decryptJwe(flipSegmentByte(jwe, 4), asKey(rsaPrivate))).rejects.toThrow()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 5. JWKS — pasted, and fetched over HTTP by MAIN
// ═══════════════════════════════════════════════════════════════════════════

describe('verification against a JWKS', () => {
  /** Public JWK for the RSA fixture, with the RFC 7638 style `kid` the token carries. */
  async function rsaJwk(kid: string): Promise<JsonWebKey & { kid: string; alg: string }> {
    const jwk = rsaPublic.export({ format: 'jwk' }) as JsonWebKey
    return { ...jwk, kid, alg: 'RS256' }
  }

  it('a pasted JWKS selects the key by kid and verifies', async () => {
    const jwks = { keys: [await rsaJwk('primary')] }
    const token = await signJwt({ sub: 'u' }, asKey(rsaPrivate), 'RS256', { kid: 'primary' })

    const res = await verifyJwtWithJwks(token, jwks as never, ['RS256'], { currentDate: NOW_MS })
    expect(res.payload.sub).toBe('u')
    expect(res.header.kid).toBe('primary')
  })

  it('a kid absent from the set is rejected — there is no fallback key', async () => {
    const jwks = { keys: [await rsaJwk('primary')] }
    const token = await signJwt({ sub: 'u' }, asKey(rsaPrivate), 'RS256', { kid: 'not-in-jwks' })

    await expect(
      verifyJwtWithJwks(token, jwks as never, ['RS256'], { currentDate: NOW_MS }),
    ).rejects.toThrow()
  })

  it('fetches a JWKS over HTTP and verifies against it', async () => {
    const jwk = await rsaJwk('served')
    const server = createServer((_req, res) => {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ keys: [jwk] }))
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as { port: number }).port
    const uri = `http://127.0.0.1:${port}/.well-known/jwks.json`

    const token = await signJwt({ sub: 'remote' }, asKey(rsaPrivate), 'RS256', { kid: 'served' })
    const res = await verifyJwtWithJwksUri(token, uri, ['RS256'], { currentDate: NOW_MS })
    expect(res.payload.sub).toBe('remote')

    // And the allowlist still bites: a token that swapped alg to HS256, signed
    // with the very public key the JWKS publishes, must NOT be accepted.
    const forged = await signJwt({ admin: true }, secretKey(JSON.stringify(jwk)), 'HS256', {
      kid: 'served',
    })
    await expect(
      verifyJwtWithJwksUri(forged, uri, ['RS256'], { currentDate: NOW_MS }),
    ).rejects.toThrow()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 6. Decode stays a debugger view, never a trust decision
// ═══════════════════════════════════════════════════════════════════════════

describe('decodeToken', () => {
  it('reads header and claims without any key and without verifying', async () => {
    const token = await signJwt(
      { sub: 'carol', exp: NOW_SECONDS - 1 },
      secretKey(HS_SECRET),
      'HS256',
    )
    const decoded = decodeToken(token)
    expect(decoded.header.alg).toBe('HS256')
    expect(decoded.payload.sub).toBe('carol')
    // Expired, tampered or forged — decode does not care. That is the point:
    // it must never be mistaken for verification.
    expect(decodeToken(`${token.split('.').slice(0, 2).join('.')}.`).payload.sub).toBe('carol')
  })
})
