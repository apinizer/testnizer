import { describe, it, expect } from 'vitest'
import {
  hashString,
  hashAll,
  hmacString,
  hmacAll,
  HASH_ALGORITHMS,
  HMAC_ALGORITHMS,
} from '../../../src/renderer/lib/tools/hash'

// Reference vectors come from RFC 1321 (MD5), FIPS 180-4 / RFC 6234 (SHA family),
// and RFC 4231 (HMAC test vectors).

describe('hashString — MD5 (RFC 1321 test suite)', () => {
  it.each([
    ['', 'd41d8cd98f00b204e9800998ecf8427e'],
    ['a', '0cc175b9c0f1b6a831c399e269772661'],
    ['abc', '900150983cd24fb0d6963f7d28e17f72'],
    ['message digest', 'f96b697d7cb7938d525a2f31aaf161d0'],
    ['abcdefghijklmnopqrstuvwxyz', 'c3fcd3d76192e4007dfb496cca67e13b'],
  ])('MD5(%j) = %s', async (input, expected) => {
    expect(await hashString(input, 'MD5')).toBe(expected)
  })
})

describe('hashString — SHA-1', () => {
  it('SHA-1("abc")', async () => {
    expect(await hashString('abc', 'SHA-1')).toBe('a9993e364706816aba3e25717850c26c9cd0d89d')
  })

  it('SHA-1("")', async () => {
    expect(await hashString('', 'SHA-1')).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709')
  })
})

describe('hashString — SHA-256 (FIPS 180-4)', () => {
  it('SHA-256("abc")', async () => {
    expect(await hashString('abc', 'SHA-256')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })

  it('SHA-256("")', async () => {
    expect(await hashString('', 'SHA-256')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
  })
})

describe('hashString — SHA-384', () => {
  it('SHA-384("abc")', async () => {
    expect(await hashString('abc', 'SHA-384')).toBe(
      'cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7',
    )
  })
})

describe('hashString — SHA-512', () => {
  it('SHA-512("abc")', async () => {
    expect(await hashString('abc', 'SHA-512')).toBe(
      'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a' +
        '2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f',
    )
  })

  it('SHA-512("")', async () => {
    expect(await hashString('', 'SHA-512')).toBe(
      'cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce' +
        '47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e',
    )
  })
})

describe('hashAll', () => {
  it('returns an entry for every algorithm', async () => {
    const all = await hashAll('abc')
    for (const alg of HASH_ALGORITHMS) {
      expect(all[alg]).toBeTypeOf('string')
      expect(all[alg].length).toBeGreaterThan(0)
    }
  })

  it('lengths match the canonical hex digest size', async () => {
    const all = await hashAll('hello')
    expect(all['MD5'].length).toBe(32) // 128 bits
    expect(all['SHA-1'].length).toBe(40) // 160 bits
    expect(all['SHA-256'].length).toBe(64) // 256 bits
    expect(all['SHA-384'].length).toBe(96) // 384 bits
    expect(all['SHA-512'].length).toBe(128) // 512 bits
  })
})

describe('hmacString (RFC 4231 vectors)', () => {
  // Test Case 4: key = 0x0102…0x19 (25 bytes), data = repeated 0xcd × 50.
  // We use the Latin-1 path: TextEncoder UTF-8 encodes 0x00–0x7f identically.
  // For test case 4 we stick to ASCII data to avoid UTF-8 multi-byte differences.

  it('HMAC-SHA256 with the canonical "Jefe" example', async () => {
    // RFC 4231 Test Case 2: key = "Jefe", data = "what do ya want for nothing?"
    const expected = '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843'
    const got = await hmacString('what do ya want for nothing?', 'Jefe', 'HMAC-SHA256')
    expect(got).toBe(expected)
  })

  it('HMAC-SHA1 with the "Jefe" example', async () => {
    const expected = 'effcdf6ae5eb2fa2d27416d5f184df9c259a7c79'
    const got = await hmacString('what do ya want for nothing?', 'Jefe', 'HMAC-SHA1')
    expect(got).toBe(expected)
  })

  it('HMAC-SHA512 with the "Jefe" example', async () => {
    const expected =
      '164b7a7bfcf819e2e395fbe73b56e0a387bd64222e831fd610270cd7ea2505549758bf75c05a994a6d034f65f8f0e6fdcaeab1a34d4a6b4b636e070a38bce737'
    const got = await hmacString('what do ya want for nothing?', 'Jefe', 'HMAC-SHA512')
    expect(got).toBe(expected)
  })

  it('HMAC-SHA384 with the "Jefe" example', async () => {
    const expected =
      'af45d2e376484031617f78d2b58a6b1b9c7ef464f5a01b47e42ec3736322445e8e2240ca5e69e2c78b3239ecfab21649'
    const got = await hmacString('what do ya want for nothing?', 'Jefe', 'HMAC-SHA384')
    expect(got).toBe(expected)
  })
})

describe('hmacAll', () => {
  it('returns one entry per algorithm with non-empty hex', async () => {
    const all = await hmacAll('msg', 'key')
    for (const alg of HMAC_ALGORITHMS) {
      expect(all[alg]).toMatch(/^[0-9a-f]+$/)
    }
  })

  it('digest lengths match the SHA family size', async () => {
    const all = await hmacAll('msg', 'key')
    expect(all['HMAC-SHA1'].length).toBe(40)
    expect(all['HMAC-SHA256'].length).toBe(64)
    expect(all['HMAC-SHA384'].length).toBe(96)
    expect(all['HMAC-SHA512'].length).toBe(128)
  })
})
