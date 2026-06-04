import { describe, it, expect } from 'vitest'
import {
  isAsymmetric,
  claimsToTable,
  generateSampleJwt,
  verifyJwt,
  decodeJwt,
} from '../../../src/renderer/lib/tools/jwt'

describe('isAsymmetric', () => {
  it('returns false for HMAC algorithms', () => {
    expect(isAsymmetric('HS256')).toBe(false)
    expect(isAsymmetric('HS384')).toBe(false)
    expect(isAsymmetric('HS512')).toBe(false)
  })

  it('returns true for RSA / ECDSA / EdDSA / PSS', () => {
    expect(isAsymmetric('RS256')).toBe(true)
    expect(isAsymmetric('PS384')).toBe(true)
    expect(isAsymmetric('ES512')).toBe(true)
    expect(isAsymmetric('EdDSA')).toBe(true)
  })

  it('returns false for "none"', () => {
    expect(isAsymmetric('none')).toBe(false)
  })
})

describe('claimsToTable', () => {
  it('lists every claim as a row with key/value/raw', () => {
    const rows = claimsToTable({ sub: 'abc', count: 7, ok: true })
    expect(rows).toHaveLength(3)
    const sub = rows.find((r) => r.key === 'sub')
    expect(sub?.value).toBe('abc')
    expect(sub?.raw).toBe('abc')
    expect(sub?.iso).toBeUndefined()
  })

  it('emits ISO timestamps for date-like numeric claims', () => {
    const iat = 1735689600 // 2025-01-01T00:00:00Z
    const rows = claimsToTable({ iat, exp: iat + 60, nbf: iat - 60, auth_time: iat })
    expect(rows.find((r) => r.key === 'iat')?.iso).toBe('2025-01-01T00:00:00.000Z')
    expect(rows.find((r) => r.key === 'exp')?.iso).toBe('2025-01-01T00:01:00.000Z')
    expect(rows.find((r) => r.key === 'nbf')?.iso).toBe('2024-12-31T23:59:00.000Z')
    expect(rows.find((r) => r.key === 'auth_time')?.iso).toBe('2025-01-01T00:00:00.000Z')
  })

  it('attaches descriptions for known standard claims', () => {
    const rows = claimsToTable({ iss: 'me', sub: 'you', random: 1 })
    expect(rows.find((r) => r.key === 'iss')?.description).toBeDefined()
    expect(rows.find((r) => r.key === 'sub')?.description).toBeDefined()
    expect(rows.find((r) => r.key === 'random')?.description).toBeUndefined()
  })

  it('JSON-stringifies non-string values', () => {
    const rows = claimsToTable({ obj: { a: 1 }, arr: [1, 2] })
    expect(rows.find((r) => r.key === 'obj')?.value).toBe('{"a":1}')
    expect(rows.find((r) => r.key === 'arr')?.value).toBe('[1,2]')
  })
})

describe('generateSampleJwt — round-trip per algorithm', () => {
  it('HS256 sample is verifiable with the returned secret', async () => {
    const r = await generateSampleJwt('HS256')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.sample.token.split('.').length).toBe(3)
    expect(r.sample.secret).toBeTypeOf('string')
    const v = await verifyJwt(r.sample.token, r.sample.secret!, 'HS256')
    expect(v.ok).toBe(true)
    if (v.ok) expect(v.valid).toBe(true)
  })

  it('RS256 sample is verifiable with the returned public key', async () => {
    const r = await generateSampleJwt('RS256')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.sample.publicKey).toMatch(/BEGIN PUBLIC KEY/)
    expect(r.sample.privateKey).toMatch(/BEGIN PRIVATE KEY/)
    const v = await verifyJwt(r.sample.token, r.sample.publicKey!, 'RS256')
    expect(v.ok).toBe(true)
    if (v.ok) expect(v.valid).toBe(true)
  })

  it('ES256 sample is verifiable with the returned public key', async () => {
    const r = await generateSampleJwt('ES256')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const v = await verifyJwt(r.sample.token, r.sample.publicKey!, 'ES256')
    expect(v.ok).toBe(true)
    if (v.ok) expect(v.valid).toBe(true)
  })

  it('alg=none sample produces an unsigned token', async () => {
    const r = await generateSampleJwt('none')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const decoded = decodeJwt(r.sample.token)
    expect(decoded.ok).toBe(true)
    if (decoded.ok) {
      expect(decoded.jwt.header.alg).toBe('none')
      expect(decoded.jwt.signature).toBe('')
    }
  })

  it('produces a payload with the expected claims', async () => {
    const r = await generateSampleJwt('HS256')
    if (!r.ok) throw new Error(r.error)
    const decoded = decodeJwt(r.sample.token)
    if (!decoded.ok) throw new Error(decoded.error)
    expect(decoded.jwt.payload).toMatchObject({
      sub: '1234567890',
      name: 'John Doe',
      admin: true,
    })
    expect(typeof decoded.jwt.payload.iat).toBe('number')
  })
})
