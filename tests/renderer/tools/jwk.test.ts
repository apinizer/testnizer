/**
 * JWK tool — pure logic (#61, Faz D1). Runs in the node `|tools|` vitest project:
 * no DOM, no IPC, no keystore. Everything here operates on material the USER
 * pasted or generated, which is exactly the tool's default (and only pure) path.
 *
 * The load-bearing checks:
 *  - RFC 7638 known-answer vector for the thumbprint we advertise as `kid`;
 *  - PEM ⇄ JWK round-trips for RSA / EC / X.509, pinned by thumbprint equality
 *    (the same key must keep the same `kid` through every representation);
 *  - the public-only guarantee: `toPublicJwk` / `buildPublicJwks` never let a
 *    private member (or a symmetric key) into a publishable set.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  PRIVATE_JWK_MEMBERS,
  buildPublicJwks,
  detectPemKind,
  generateJwkPair,
  inferAlg,
  isJwksAcceptable,
  isPrivateJwk,
  jwkThumbprint,
  jwkToPem,
  parseJwkText,
  pemToJwk,
  prettyJwk,
  summarizeJwk,
  toPublicJwk,
  validateJwk,
  type Jwk,
} from '../../../src/renderer/lib/tools/jwk'

const FIXTURES = resolve(__dirname, '../../fixtures/certs')
const fixture = (name: string): string => readFileSync(resolve(FIXTURES, name), 'utf8')

/** RFC 7638 §3.1 — the canonical thumbprint vector. */
const RFC7638_JWK: Jwk = {
  kty: 'RSA',
  n:
    '0vx7agoebGcQSuuPiLJXZptN9nndrQmbXEps2aiAFbWhM78LhWx4cbbfAAtVT86zwu1RK7aPFFxuhDR1L6tSoc_BJ' +
    'ECPebWKRXjBZCiFV4n3oknjhMstn64tZ_2W-5JsGY4Hc5n9yBXArwl93lqt7_RN5w6Cf0h4QyQ5v-65YGjQR0_FDW' +
    '2QvzqY368QQMicAtaSqzs8KJZgnYb9c7d0zgdAZHzu6qMQvRL5hajrn1n91CbOpbISD08qNLyrdkt-bFTWhAI4vMQ' +
    'Fh6WeZu0fM4lFd2NcRwr3XPksINHaQ-G_xBniIqbw0Ls1jF44-csFCur-kEgU8awapJzKnqDKgw',
  e: 'AQAB',
  alg: 'RS256',
  kid: '2011-04-29',
}
const RFC7638_THUMBPRINT = 'NzbLsXh8uDCcd-6MNwXF4W_7noWXFZAfHkxZsRGC9Xs'

function unwrap<T>(r: { ok: true; value: T } | { ok: false; error: string }): T {
  if (!r.ok) throw new Error(r.error)
  return r.value
}

describe('RFC 7638 thumbprint (known-answer test)', () => {
  it('reproduces the RFC vector, ignoring kid/alg as the RFC requires', async () => {
    const r = unwrap(await jwkThumbprint(RFC7638_JWK))
    expect(r.thumbprint).toBe(RFC7638_THUMBPRINT)
    expect(r.uri).toBe(`urn:ietf:params:oauth:jwk-thumbprint:sha-256:${RFC7638_THUMBPRINT}`)
  })

  it('supports the larger digests too', async () => {
    const sha384 = unwrap(await jwkThumbprint(RFC7638_JWK, 'sha384'))
    expect(sha384.thumbprint).not.toBe(RFC7638_THUMBPRINT)
    expect(sha384.uri).toContain('sha-384')
  })
})

describe('detectPemKind', () => {
  it('classifies the three Web Crypto-readable labels', () => {
    expect(detectPemKind(fixture('client.crt')).kind).toBe('certificate')
    expect(detectPemKind(fixture('client.pkcs8.key')).kind).toBe('privateKey')
    expect(detectPemKind('-----BEGIN PUBLIC KEY-----\nAA\n-----END PUBLIC KEY-----').kind).toBe(
      'publicKey',
    )
  })

  it('names PKCS#1 / SEC1 / encrypted PKCS#8 as unsupported with a conversion hint', () => {
    for (const label of ['RSA PRIVATE KEY', 'EC PRIVATE KEY', 'ENCRYPTED PRIVATE KEY']) {
      const d = detectPemKind(`-----BEGIN ${label}-----\nAA\n-----END ${label}-----`)
      expect(d.kind).toBe('unsupported')
      expect(d.hint).toMatch(/openssl/)
    }
    // client.key is the SEC1/PKCS#1 sibling of the PKCS#8 fixture.
    expect(detectPemKind(fixture('ec-p256.key')).kind).toBe('unsupported')
  })

  it('reports plain garbage rather than guessing', () => {
    expect(detectPemKind('not a pem').kind).toBe('unknown')
  })
})

describe('PEM → JWK', () => {
  it('reads an RSA X.509 certificate into a PUBLIC JWK with an RFC 7638 kid', async () => {
    const r = unwrap(await pemToJwk(fixture('client.crt')))
    expect(r.source).toBe('certificate')
    expect(r.isPrivate).toBe(false)
    expect(r.jwk.kty).toBe('RSA')
    expect(r.alg).toBe('RS256')
    expect(r.kid).toBe(r.jwk.kid)
    for (const m of PRIVATE_JWK_MEMBERS) expect(r.jwk).not.toHaveProperty(m)
  })

  it('reads a PKCS#8 private key into a PRIVATE JWK with the SAME kid as its certificate', async () => {
    const cert = unwrap(await pemToJwk(fixture('client.crt')))
    const key = unwrap(await pemToJwk(fixture('client.pkcs8.key')))
    expect(key.isPrivate).toBe(true)
    expect(key.jwk.d).toBeTypeOf('string')
    // The thumbprint is computed over the REQUIRED members only, so the private
    // half and the certificate's public half must agree — that is what makes it
    // usable as a stable `kid`.
    expect(key.kid).toBe(cert.kid)
  })

  it('auto-detects EC curves without being told the algorithm', async () => {
    const p256 = unwrap(await pemToJwk(fixture('ec-p256.crt')))
    expect(p256.jwk.kty).toBe('EC')
    expect(p256.jwk.crv).toBe('P-256')
    expect(p256.alg).toBe('ES256')

    const p384 = unwrap(await pemToJwk(fixture('ec-p384.crt')))
    expect(p384.jwk.crv).toBe('P-384')
    expect(p384.alg).toBe('ES384')
  })

  it('honours an explicit algorithm and reports the mismatch when it is wrong', async () => {
    const r = await pemToJwk(fixture('ec-p256.crt'), 'RS256')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('RS256')
  })

  it('refuses a PKCS#1 key with the openssl conversion line', async () => {
    const r = await pemToJwk(fixture('ec-p256.key'))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/pkcs8/)
  })

  it('refuses empty input', async () => {
    const r = await pemToJwk('   ')
    expect(r.ok).toBe(false)
  })
})

describe('JWK → PEM (round-trip)', () => {
  it('rebuilds the SPKI of a certificate key and keeps the thumbprint', async () => {
    const first = unwrap(await pemToJwk(fixture('client.crt')))
    const pem = unwrap(await jwkToPem(first.jwk))
    expect(pem.kind).toBe('public')
    expect(pem.pem).toContain('BEGIN PUBLIC KEY')

    const back = unwrap(await pemToJwk(pem.pem))
    expect(back.kid).toBe(first.kid)
  })

  it('rebuilds PKCS#8 from a private JWK and keeps the thumbprint', async () => {
    const first = unwrap(await pemToJwk(fixture('client.pkcs8.key')))
    const pem = unwrap(await jwkToPem(first.jwk))
    expect(pem.kind).toBe('private')
    expect(pem.pem).toContain('BEGIN PRIVATE KEY')

    const back = unwrap(await pemToJwk(pem.pem))
    expect(back.kid).toBe(first.kid)
    expect(back.isPrivate).toBe(true)
  })

  it('round-trips an EC P-384 key', async () => {
    const first = unwrap(await pemToJwk(fixture('ec-p384.pkcs8.key')))
    const pem = unwrap(await jwkToPem(first.jwk))
    const back = unwrap(await pemToJwk(pem.pem))
    expect(back.kid).toBe(first.kid)
    expect(back.jwk.crv).toBe('P-384')
  })

  it('refuses a symmetric key — an oct JWK has no PEM form', async () => {
    const r = await jwkToPem({ kty: 'oct', k: 'c2VjcmV0LXZhbHVl' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/symmetric/i)
  })

  it('asks for an algorithm when the JWK declares none it can infer', async () => {
    const r = await jwkToPem({ kty: 'EC', crv: 'secp256k1', x: 'AA', y: 'BB' })
    expect(r.ok).toBe(false)
  })
})

describe('generateJwkPair', () => {
  it('produces both halves as JWK + PEM sharing one kid', async () => {
    const r = unwrap(await generateJwkPair('ES256'))
    expect(r.publicJwk.kty).toBe('EC')
    expect(r.publicJwk.crv).toBe('P-256')
    expect(r.publicJwk.kid).toBe(r.kid)
    expect(r.privateJwk.kid).toBe(r.kid)
    expect(r.privateJwk.d).toBeTypeOf('string')
    // The public half is publishable as generated.
    for (const m of PRIVATE_JWK_MEMBERS) expect(r.publicJwk).not.toHaveProperty(m)
    expect(r.publicPem).toContain('BEGIN PUBLIC KEY')
    expect(r.privatePem).toContain('BEGIN PRIVATE KEY')
  })

  it('generates a distinct key every time', async () => {
    const a = unwrap(await generateJwkPair('ES256'))
    const b = unwrap(await generateJwkPair('ES256'))
    expect(a.kid).not.toBe(b.kid)
  })

  it('honours the RSA modulus length', async () => {
    const r = unwrap(await generateJwkPair('RS256', { modulusLength: 3072 }))
    expect(summarizeJwk(r.publicJwk).bits).toBe(3072)
  })

  it('reports an unusable algorithm instead of throwing', async () => {
    const r = await generateJwkPair('HS256')
    expect(r.ok).toBe(false)
  })
})

describe('public-only guarantees', () => {
  it('strips EVERY private member, including RSA multi-prime "oth"', async () => {
    const priv = unwrap(await pemToJwk(fixture('client.pkcs8.key'))).jwk
    // Sanity: the input really is private before we strip it.
    expect(priv.d).toBeTypeOf('string')
    expect(priv.p).toBeTypeOf('string')
    expect(priv.q).toBeTypeOf('string')

    const withOth = { ...priv, oth: [{ r: 'r', d: 'd', t: 't' }] } as Jwk
    const pub = toPublicJwk(withOth)
    for (const m of PRIVATE_JWK_MEMBERS) expect(pub).not.toHaveProperty(m)
    // Not just absent as properties — the secret VALUES are nowhere in the text.
    const serialized = prettyJwk(pub)
    expect(serialized).not.toContain(String(priv.d))
    expect(serialized).not.toContain(String(priv.p))
    // …and the public half survived intact.
    expect(pub.n).toBe(priv.n)
    expect(pub.e).toBe(priv.e)
    expect(isPrivateJwk(pub)).toBe(false)
  })

  it('buildPublicJwks sanitises, refuses oct keys and de-duplicates by kid', async () => {
    const priv = unwrap(await pemToJwk(fixture('client.pkcs8.key'))).jwk
    const ec = unwrap(await pemToJwk(fixture('ec-p256.crt'))).jwk
    const built = buildPublicJwks([priv, ec, { ...priv }, { kty: 'oct', k: 'c2VjcmV0' }])

    expect(built.jwks.keys).toHaveLength(2)
    expect(built.stripped).toBe(2)
    expect(built.deduped).toBe(1)
    expect(built.omittedOct).toBe(1)

    const body = JSON.stringify(built.jwks)
    for (const m of PRIVATE_JWK_MEMBERS) expect(body).not.toContain(`"${m}"`)
    expect(body).not.toContain(String(priv.d))
    expect(body).not.toContain('c2VjcmV0')
  })

  it('the assembled set is createLocalJWKSet-acceptable', async () => {
    const rsa = unwrap(await pemToJwk(fixture('client.crt'))).jwk
    const ec = unwrap(await pemToJwk(fixture('ec-p256.crt'))).jwk
    const built = buildPublicJwks([rsa, ec])
    expect(unwrap(isJwksAcceptable(built.jwks))).toBe(2)
  })

  it('rejects a document that is not a JWK Set', () => {
    const r = isJwksAcceptable({ keys: 'nope' } as unknown as { keys: Jwk[] })
    expect(r.ok).toBe(false)
  })
})

describe('parse / validate / summarize', () => {
  it('parses a single JWK and a JWK Set', () => {
    const single = unwrap(parseJwkText(JSON.stringify(RFC7638_JWK)))
    expect(single.isSet).toBe(false)
    expect(single.keys).toHaveLength(1)

    const set = unwrap(parseJwkText(JSON.stringify({ keys: [RFC7638_JWK, RFC7638_JWK] })))
    expect(set.isSet).toBe(true)
    expect(set.keys).toHaveLength(2)
  })

  it('points at the offending key by position', () => {
    const r = parseJwkText(JSON.stringify({ keys: [RFC7638_JWK, { kty: 'RSA', e: 'AQAB' }] }))
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toContain('Key #2')
      expect(r.error).toContain('n')
    }
  })

  it('reports invalid JSON as such', () => {
    const r = parseJwkText('{ nope')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/Invalid JSON/)
  })

  it('validates required members per key type', () => {
    expect(validateJwk({ kty: 'EC', crv: 'P-256', x: 'a', y: 'b' }).ok).toBe(true)
    expect(validateJwk({ kty: 'EC', crv: 'P-256', x: 'a' }).ok).toBe(false)
    expect(validateJwk({ kty: 'OKP', crv: 'Ed25519', x: 'a' }).ok).toBe(true)
    expect(validateJwk({ alg: 'RS256' }).ok).toBe(false)
    expect(validateJwk({ kty: 'MAGIC' }).ok).toBe(false)
    expect(validateJwk([]).ok).toBe(false)
  })

  it('summarises size, curve and privacy', async () => {
    const rsa = unwrap(await pemToJwk(fixture('client.crt'))).jwk
    const rsaSummary = summarizeJwk(rsa)
    expect(rsaSummary.kty).toBe('RSA')
    expect(rsaSummary.bits).toBe(2048)
    expect(rsaSummary.isPrivate).toBe(false)

    const ec = unwrap(await pemToJwk(fixture('ec-p384.pkcs8.key'))).jwk
    const ecSummary = summarizeJwk(ec)
    expect(ecSummary.crv).toBe('P-384')
    expect(ecSummary.bits).toBe(384)
    expect(ecSummary.isPrivate).toBe(true)
  })

  it('prettyJwk orders members deterministically', () => {
    const a = prettyJwk({ kty: 'RSA', e: 'AQAB', n: 'abc' })
    const b = prettyJwk({ n: 'abc', kty: 'RSA', e: 'AQAB' })
    expect(a).toBe(b)
    expect(Object.keys(JSON.parse(a))).toEqual(['e', 'kty', 'n'])
  })

  it('infers a sensible alg per key type', () => {
    expect(inferAlg({ kty: 'RSA', n: 'a', e: 'b' })).toBe('RS256')
    expect(inferAlg({ kty: 'EC', crv: 'P-521' })).toBe('ES512')
    expect(inferAlg({ kty: 'OKP', crv: 'Ed25519' })).toBe('EdDSA')
    expect(inferAlg({ kty: 'RSA', alg: 'PS512' })).toBe('PS512')
    expect(inferAlg({ kty: 'oct', k: 'a' })).toBeUndefined()
  })
})
