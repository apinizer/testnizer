import { describe, it, expect } from 'vitest'
import {
  decodeJwt,
  verifyJwt,
  signJwt,
  isExpired,
  isNotYetValid,
  secondsUntilExpiry,
  humanReadableClaims,
  JWT_ALGORITHMS,
} from '../../../src/renderer/lib/tools/jwt'

// Static fixtures (RFC 7519 examples + jwt.io samples)
const FIXTURES = {
  // HS256 with secret "your-256-bit-secret"
  hs256:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
  hs256Secret: 'your-256-bit-secret',

  // alg: none, no signature
  none:
    'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiJqYW5lIiwiaWF0IjoxNTE2MjM5MDIyfQ.',

  // expired token (exp: 1000 — Jan 1970)
  expired:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ4IiwiZXhwIjoxMDAwfQ.5yk_QgLdK8Cz5VnpdTQ2FqJGcUtIrdJtAcNVqZSxZ24',
}

describe('decodeJwt', () => {
  it('decodes a valid HS256 token', () => {
    const r = decodeJwt(FIXTURES.hs256)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.jwt.header).toMatchObject({ alg: 'HS256', typ: 'JWT' })
    expect(r.jwt.payload).toMatchObject({ sub: '1234567890', name: 'John Doe', iat: 1516239022 })
    expect(r.jwt.signature).toBeTypeOf('string')
    expect(r.jwt.signature.length).toBeGreaterThan(0)
  })

  it('decodes alg=none token', () => {
    const r = decodeJwt(FIXTURES.none)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.jwt.header.alg).toBe('none')
    expect(r.jwt.signature).toBe('')
  })

  it('preserves raw segments', () => {
    const r = decodeJwt(FIXTURES.hs256)
    if (!r.ok) throw new Error('decode failed')
    expect(`${r.jwt.raw.header}.${r.jwt.raw.payload}.${r.jwt.raw.signature}`).toBe(FIXTURES.hs256)
  })

  it('trims whitespace around token', () => {
    const r = decodeJwt('  ' + FIXTURES.hs256 + '  \n')
    expect(r.ok).toBe(true)
  })

  it('rejects empty input', () => {
    const r = decodeJwt('')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain('empty')
  })

  it('rejects null/undefined input', () => {
    expect(decodeJwt(null as unknown as string).ok).toBe(false)
    expect(decodeJwt(undefined as unknown as string).ok).toBe(false)
  })

  it('rejects 2-part token', () => {
    const r = decodeJwt('header.payload')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain('3 dot-separated parts')
    expect(r.error).toContain('got 2')
  })

  it('rejects 4-part token', () => {
    const r = decodeJwt('a.b.c.d')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain('got 4')
  })

  it('rejects non-base64 header', () => {
    const r = decodeJwt('!!!.eyJzdWIiOiJ4In0.sig')
    expect(r.ok).toBe(false)
  })

  it('rejects payload that is not JSON', () => {
    // header is valid JSON, payload is base64 of "not json"
    const r = decodeJwt('eyJhbGciOiJIUzI1NiJ9.bm90IGpzb24.sig')
    expect(r.ok).toBe(false)
  })
})

describe('verifyJwt — HS256', () => {
  it('verifies a correctly signed HS256 token', async () => {
    const r = await verifyJwt(FIXTURES.hs256, FIXTURES.hs256Secret, 'HS256')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.valid).toBe(true)
  })

  it('returns invalid for wrong secret', async () => {
    const r = await verifyJwt(FIXTURES.hs256, 'wrong-secret', 'HS256')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.valid).toBe(false)
    if (!r.valid) expect(r.reason).toBeTruthy()
  })

  it('returns invalid when expected algo differs', async () => {
    // Token is HS256; we ask for HS512
    const r = await verifyJwt(FIXTURES.hs256, FIXTURES.hs256Secret, 'HS512')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.valid).toBe(false)
  })

  it('returns invalid for an expired token', async () => {
    const r = await verifyJwt(FIXTURES.expired, FIXTURES.hs256Secret, 'HS256')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.valid).toBe(false)
  })
})

describe('verifyJwt — alg:none', () => {
  it('accepts a properly-formed alg=none token', async () => {
    const r = await verifyJwt(FIXTURES.none, '', 'none')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.valid).toBe(true)
  })

  it('rejects alg=none if header.alg is not "none"', async () => {
    // HS256 token verified as "none"
    const r = await verifyJwt(FIXTURES.hs256, '', 'none')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.valid).toBe(false)
  })

  it('rejects alg=none if signature segment is non-empty', async () => {
    // Take alg=none token but tamper signature
    const tampered = FIXTURES.none + 'AAAA'
    const r = await verifyJwt(tampered, '', 'none')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.valid).toBe(false)
  })
})

describe('signJwt + verifyJwt round-trip', () => {
  it('HS256 sign → verify → valid', async () => {
    const signed = await signJwt({ sub: 'alice', role: 'admin' }, 'top-secret', 'HS256')
    expect(signed.ok).toBe(true)
    if (!signed.ok) return
    const v = await verifyJwt(signed.token, 'top-secret', 'HS256')
    expect(v.ok).toBe(true)
    if (!v.ok) return
    expect(v.valid).toBe(true)
  })

  it('HS512 sign → verify with HS256 fails', async () => {
    const signed = await signJwt({ sub: 'bob' }, 'k', 'HS512')
    if (!signed.ok) throw new Error('sign failed')
    const v = await verifyJwt(signed.token, 'k', 'HS256')
    expect(v.ok).toBe(true)
    if (!v.ok) return
    expect(v.valid).toBe(false)
  })

  it('alg=none round-trip', async () => {
    const signed = await signJwt({ sub: 'x' }, '', 'none')
    if (!signed.ok) throw new Error('sign failed')
    expect(signed.token.endsWith('.')).toBe(true)
    const v = await verifyJwt(signed.token, '', 'none')
    expect(v.ok).toBe(true)
    if (!v.ok) return
    expect(v.valid).toBe(true)
  })

  it('signJwt rejects invalid PEM key for RS256', async () => {
    const r = await signJwt({ sub: 'x' }, 'not-a-pem', 'RS256')
    expect(r.ok).toBe(false)
  })

  it('preserves custom claims', async () => {
    const signed = await signJwt(
      { custom: { nested: ['a', 'b'] }, n: 42 },
      's',
      'HS256',
    )
    if (!signed.ok) throw new Error('sign failed')
    const decoded = decodeJwt(signed.token)
    if (!decoded.ok) throw new Error('decode failed')
    expect(decoded.jwt.payload).toMatchObject({ custom: { nested: ['a', 'b'] }, n: 42 })
  })
})

describe('isExpired', () => {
  it('returns false when exp claim is missing', () => {
    expect(isExpired({})).toBe(false)
    expect(isExpired({ sub: 'x' })).toBe(false)
  })

  it('returns true when exp is in the past', () => {
    expect(isExpired({ exp: 100 }, 200)).toBe(true)
  })

  it('returns false when exp is in the future', () => {
    expect(isExpired({ exp: 200 }, 100)).toBe(false)
  })

  it('returns false when exp equals now (boundary — strict <)', () => {
    expect(isExpired({ exp: 100 }, 100)).toBe(false)
  })

  it('ignores non-numeric exp', () => {
    expect(isExpired({ exp: 'string' as unknown as number }, 100)).toBe(false)
  })
})

describe('isNotYetValid', () => {
  it('returns true when nbf is in the future', () => {
    expect(isNotYetValid({ nbf: 200 }, 100)).toBe(true)
  })

  it('returns false when nbf is in the past', () => {
    expect(isNotYetValid({ nbf: 50 }, 100)).toBe(false)
  })

  it('returns false when nbf equals now', () => {
    expect(isNotYetValid({ nbf: 100 }, 100)).toBe(false)
  })

  it('returns false when nbf claim is missing', () => {
    expect(isNotYetValid({})).toBe(false)
  })
})

describe('secondsUntilExpiry', () => {
  it('returns positive when expiry is in the future', () => {
    expect(secondsUntilExpiry({ exp: 200 }, 100)).toBe(100)
  })

  it('returns negative when token expired', () => {
    expect(secondsUntilExpiry({ exp: 100 }, 200)).toBe(-100)
  })

  it('returns null when exp is missing', () => {
    expect(secondsUntilExpiry({})).toBe(null)
  })
})

describe('humanReadableClaims', () => {
  it('adds *_iso fields for known date claims', () => {
    const out = humanReadableClaims({ exp: 1516239022, iat: 1516239022 })
    expect(out.exp_iso).toBe(new Date(1516239022 * 1000).toISOString())
    expect(out.iat_iso).toBe(new Date(1516239022 * 1000).toISOString())
  })

  it('does not mutate the original payload', () => {
    const original = { exp: 1000, sub: 'x' }
    const out = humanReadableClaims(original)
    expect(out.exp_iso).toBeTypeOf('string')
    expect(original).toEqual({ exp: 1000, sub: 'x' })
  })

  it('skips claims that are not numeric', () => {
    const out = humanReadableClaims({ exp: 'oops' })
    expect(out.exp_iso).toBeUndefined()
  })

  it('handles all four standard date claims', () => {
    const out = humanReadableClaims({ exp: 1, iat: 2, nbf: 3, auth_time: 4 })
    expect(out.exp_iso).toBeDefined()
    expect(out.iat_iso).toBeDefined()
    expect(out.nbf_iso).toBeDefined()
    expect(out.auth_time_iso).toBeDefined()
  })
})

describe('JWT_ALGORITHMS', () => {
  it('exports a stable, complete list', () => {
    expect(JWT_ALGORITHMS).toContain('HS256')
    expect(JWT_ALGORITHMS).toContain('RS256')
    expect(JWT_ALGORITHMS).toContain('ES256')
    expect(JWT_ALGORITHMS).toContain('EdDSA')
    expect(JWT_ALGORITHMS).toContain('none')
  })
})
