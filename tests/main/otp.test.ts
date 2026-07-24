import { describe, it, expect } from 'vitest'
import {
  decodeBase32,
  hotp,
  totp,
  verifyTotp,
  parseOtpauthUri,
  buildOtpauthUri,
  type OtpAlgorithm,
} from '../../src/main/lib/otp'

// RFC 6238 uses a distinct ASCII seed per algorithm (the digits repeated to the
// key length of the hash). Getting these wrong is the classic TOTP bug.
const SEED: Record<OtpAlgorithm, Buffer> = {
  SHA1: Buffer.from('12345678901234567890', 'ascii'),
  SHA256: Buffer.from('12345678901234567890123456789012', 'ascii'),
  SHA512: Buffer.from('1234567890123456789012345678901234567890123456789012345678901234', 'ascii'),
}

describe('otp — Base32 (RFC 4648)', () => {
  it('decodes the RFC 6238 SHA1 seed', () => {
    // GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ == "12345678901234567890"
    expect(decodeBase32('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ').toString('ascii')).toBe(
      '12345678901234567890',
    )
  })

  it('decodes "JBSWY3DP" to "Hello"', () => {
    expect(decodeBase32('JBSWY3DP').toString('ascii')).toBe('Hello')
  })

  it('tolerates spaces, lowercase and padding', () => {
    const canonical = decodeBase32('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ')
    const messy = decodeBase32('gezd gnbv gy3t qojq gezd gnbv gy3t qojq====')
    expect(messy.equals(canonical)).toBe(true)
  })

  it('throws on an invalid character', () => {
    expect(() => decodeBase32('ABC1!')).toThrow(/Invalid Base32/)
  })
})

describe('otp — HOTP (RFC 4226 Appendix D)', () => {
  const EXPECTED = [
    '755224',
    '287082',
    '359152',
    '969429',
    '338314',
    '254676',
    '287922',
    '162583',
    '399871',
    '520489',
  ]
  it.each(EXPECTED.map((code, counter) => [counter, code]))(
    'HOTP(counter=%i) = %s',
    (counter, code) => {
      expect(hotp(SEED.SHA1, counter as number, { digits: 6 })).toBe(code)
    },
  )
})

describe('otp — TOTP (RFC 6238 Appendix B)', () => {
  // [unixSeconds, algorithm, expected 8-digit code]
  const VECTORS: Array<[number, OtpAlgorithm, string]> = [
    [59, 'SHA1', '94287082'],
    [59, 'SHA256', '46119246'],
    [59, 'SHA512', '90693936'],
    [1111111109, 'SHA1', '07081804'],
    [1111111109, 'SHA256', '68084774'],
    [1111111109, 'SHA512', '25091201'],
    [1111111111, 'SHA1', '14050471'],
    [1111111111, 'SHA256', '67062674'],
    [1111111111, 'SHA512', '99943326'],
    [1234567890, 'SHA1', '89005924'],
    [1234567890, 'SHA256', '91819424'],
    [1234567890, 'SHA512', '93441116'],
    [2000000000, 'SHA1', '69279037'],
    [2000000000, 'SHA256', '90698825'],
    [2000000000, 'SHA512', '38618901'],
    [20000000000, 'SHA1', '65353130'],
    [20000000000, 'SHA256', '77737706'],
    [20000000000, 'SHA512', '47863826'],
  ]

  it.each(VECTORS)('TOTP(t=%i, %s) = %s', (time, algorithm, expected) => {
    const { code } = totp(SEED[algorithm], { algorithm, digits: 8, period: 30 }, time * 1000)
    expect(code).toBe(expected)
  })

  it('reports seconds remaining in the current 30s step', () => {
    const { secondsRemaining } = totp(SEED.SHA1, { period: 30 }, 65 * 1000)
    expect(secondsRemaining).toBe(25) // 30 - (65 % 30)
  })
})

describe('otp — verifyTotp', () => {
  it('accepts the current code and rejects a wrong one', () => {
    const now = 1111111109 * 1000
    const good = totp(SEED.SHA1, { digits: 8, period: 30 }, now).code
    expect(verifyTotp(SEED.SHA1, good, { digits: 8, period: 30 }, 1, now)).toBe(true)
    expect(verifyTotp(SEED.SHA1, '00000000', { digits: 8, period: 30 }, 1, now)).toBe(false)
  })

  it('accepts a code from the previous step within the window', () => {
    const now = 1111111109 * 1000
    const prev = totp(SEED.SHA1, { digits: 8, period: 30 }, now - 30 * 1000).code
    expect(verifyTotp(SEED.SHA1, prev, { digits: 8, period: 30 }, 1, now)).toBe(true)
    expect(verifyTotp(SEED.SHA1, prev, { digits: 8, period: 30 }, 0, now)).toBe(false)
  })
})

describe('otp — parseOtpauthUri', () => {
  it('parses a full totp URI with issuer:account label', () => {
    const d = parseOtpauthUri(
      'otpauth://totp/ACME%20Co:alice@example.com?secret=GEZDGNBVGY3TQOJQ&issuer=ACME%20Co&algorithm=SHA256&digits=8&period=60',
    )
    expect(d.type).toBe('totp')
    expect(d.issuer).toBe('ACME Co')
    expect(d.account).toBe('alice@example.com')
    expect(d.secret).toBe('GEZDGNBVGY3TQOJQ')
    expect(d.algorithm).toBe('SHA256')
    expect(d.digits).toBe(8)
    expect(d.period).toBe(60)
  })

  it('parses hotp and defaults algorithm/digits/period', () => {
    const d = parseOtpauthUri('otpauth://hotp/Bob?secret=GEZDGNBVGY3TQOJQ&counter=5')
    expect(d.type).toBe('hotp')
    expect(d.algorithm).toBe('SHA1')
    expect(d.digits).toBe(6)
    expect(d.period).toBe(30)
    expect(d.counter).toBe(5)
  })

  it('rejects a non-otpauth URI and a missing secret', () => {
    expect(() => parseOtpauthUri('https://example.com')).toThrow(/otpauth/)
    expect(() => parseOtpauthUri('otpauth://totp/Bob?issuer=x')).toThrow(/secret/)
  })
})

describe('otp — buildOtpauthUri ↔ parseOtpauthUri round-trip', () => {
  it('round-trips a totp entry', () => {
    const uri = buildOtpauthUri({
      type: 'totp',
      issuer: 'ACME Co',
      account: 'alice@example.com',
      secret: 'GEZDGNBVGY3TQOJQ',
      algorithm: 'SHA256',
      digits: 8,
      period: 60,
      counter: 0,
    })
    expect(uri.startsWith('otpauth://totp/')).toBe(true)
    const d = parseOtpauthUri(uri)
    expect(d.issuer).toBe('ACME Co')
    expect(d.account).toBe('alice@example.com')
    expect(d.secret).toBe('GEZDGNBVGY3TQOJQ')
    expect(d.algorithm).toBe('SHA256')
    expect(d.digits).toBe(8)
    expect(d.period).toBe(60)
  })

  it('round-trips an hotp entry with a counter', () => {
    const uri = buildOtpauthUri({
      type: 'hotp',
      issuer: 'Svc',
      account: 'bob',
      secret: 'GEZDGNBVGY3TQOJQ',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      counter: 7,
    })
    const d = parseOtpauthUri(uri)
    expect(d.type).toBe('hotp')
    expect(d.counter).toBe(7)
    expect(d.account).toBe('bob')
  })
})
