import { describe, it, expect } from 'vitest'
import { parseToBytes, bytesToAll } from '../../../src/renderer/lib/tools/base-converter'

describe('parseToBytes — ASCII', () => {
  it('encodes ASCII as UTF-8 bytes', () => {
    expect(parseToBytes('ascii', 'Hi')).toEqual([0x48, 0x69])
  })

  it('encodes multi-byte UTF-8 characters', () => {
    expect(parseToBytes('ascii', '€')).toEqual([0xe2, 0x82, 0xac])
  })

  it('returns empty array for empty input', () => {
    expect(parseToBytes('ascii', '')).toEqual([])
  })
})

describe('parseToBytes — Binary', () => {
  it('parses space-separated binary bytes', () => {
    expect(parseToBytes('bin', '01001000 01101001')).toEqual([0x48, 0x69])
  })

  it('rejects digits other than 0/1', () => {
    expect(() => parseToBytes('bin', '01002000')).toThrow(/binary/)
  })

  it('rejects values out of byte range', () => {
    // 9 bits = up to 511; should fail the 0–255 byte range check.
    expect(() => parseToBytes('bin', '100000000')).toThrow(/byte/)
  })
})

describe('parseToBytes — Octal', () => {
  it('parses octal bytes', () => {
    expect(parseToBytes('oct', '110 151')).toEqual([72, 105])
  })

  it('rejects digit 8', () => {
    expect(() => parseToBytes('oct', '178')).toThrow(/octal/)
  })
})

describe('parseToBytes — Decimal', () => {
  it('parses decimal bytes', () => {
    expect(parseToBytes('dec', '72 105 33')).toEqual([72, 105, 33])
  })

  it('rejects values > 255', () => {
    expect(() => parseToBytes('dec', '300')).toThrow(/byte/)
  })

  it('rejects non-numeric tokens', () => {
    expect(() => parseToBytes('dec', '12 abc')).toThrow(/decimal/)
  })
})

describe('parseToBytes — Hex', () => {
  it('parses hex bytes', () => {
    expect(parseToBytes('hex', '48 69')).toEqual([0x48, 0x69])
  })

  it('accepts uppercase and 0x prefix', () => {
    expect(parseToBytes('hex', '0xFE 0Xab')).toEqual([0xfe, 0xab])
  })

  it('rejects invalid hex digits', () => {
    expect(() => parseToBytes('hex', 'gg')).toThrow(/hexadecimal/)
  })
})

describe('bytesToAll', () => {
  it('renders all five representations for "Hi"', () => {
    const f = bytesToAll([0x48, 0x69])
    expect(f.ascii).toBe('Hi')
    expect(f.bin).toBe('01001000 01101001')
    expect(f.oct).toBe('110 151')
    expect(f.dec).toBe('72 105')
    expect(f.hex).toBe('48 69')
  })

  it('pads bytes to canonical widths', () => {
    const f = bytesToAll([0x01, 0x0a])
    expect(f.bin).toBe('00000001 00001010')
    expect(f.oct).toBe('001 012')
    expect(f.hex).toBe('01 0a')
  })

  it('round-trips ASCII through bytes-and-back', () => {
    const bytes = parseToBytes('ascii', 'Hello, world!')
    const back = bytesToAll(bytes)
    expect(back.ascii).toBe('Hello, world!')
  })

  it('round-trips hex → bytes → hex', () => {
    const hex = '48 65 6c 6c 6f'
    const bytes = parseToBytes('hex', hex)
    const back = bytesToAll(bytes)
    expect(back.hex).toBe(hex)
    expect(back.ascii).toBe('Hello')
  })
})
