/**
 * Pure-data conversions between ASCII / Binary / Octal / Decimal / Hex
 * representations of a UTF-8 byte sequence. Extracted from
 * BaseConverterTool so it can be unit-tested in isolation.
 */

export type Source = 'ascii' | 'bin' | 'oct' | 'dec' | 'hex'

export type Fields = {
  ascii: string
  bin: string
  oct: string
  dec: string
  hex: string
}

export const EMPTY_FIELDS: Fields = { ascii: '', bin: '', oct: '', dec: '', hex: '' }

/** Parse a representation into the underlying byte array. Throws on malformed input. */
export function parseToBytes(source: Source, raw: string): number[] {
  if (source === 'ascii') return Array.from(new TextEncoder().encode(raw))
  const tokens = raw.trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return []
  return tokens.map((tok, i) => {
    const cleaned = source === 'hex' ? tok.toLowerCase().replace(/^0x/i, '') : tok
    if (source === 'bin' && !/^[01]+$/.test(tok)) throw new Error(`Token "${tok}" is not binary.`)
    if (source === 'oct' && !/^[0-7]+$/.test(tok)) throw new Error(`Token "${tok}" is not octal.`)
    if (source === 'dec' && !/^\d+$/.test(tok)) throw new Error(`Token "${tok}" is not decimal.`)
    if (source === 'hex' && !/^(?:0[xX])?[0-9a-fA-F]+$/.test(tok))
      throw new Error(`Token "${tok}" is not hexadecimal.`)
    const n = parseInt(cleaned, baseFor(source))
    if (!Number.isFinite(n) || n < 0 || n > 255) {
      throw new Error(`Token #${i + 1} ("${tok}") is not a valid ${source} byte (0–255).`)
    }
    return n
  })
}

/** Render a byte array into all five representations. */
export function bytesToAll(bytes: number[]): Fields {
  const ascii = new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(bytes))
  return {
    ascii,
    bin: bytes.map((b) => b.toString(2).padStart(8, '0')).join(' '),
    oct: bytes.map((b) => b.toString(8).padStart(3, '0')).join(' '),
    dec: bytes.map((b) => b.toString(10)).join(' '),
    hex: bytes.map((b) => b.toString(16).padStart(2, '0')).join(' '),
  }
}

function baseFor(s: Source): number {
  switch (s) {
    case 'bin':
      return 2
    case 'oct':
      return 8
    case 'dec':
      return 10
    case 'hex':
      return 16
    default:
      return 10
  }
}
