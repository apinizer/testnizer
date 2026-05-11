import { describe, it, expect } from 'vitest'
import { rowsToBulkText, bulkTextToRows } from '../../src/renderer/lib/key-value-bulk'
import type { KeyValuePair } from '../../src/renderer/types'

function row(
  partial: Partial<KeyValuePair> & Pick<KeyValuePair, 'key' | 'value'>,
): KeyValuePair {
  return {
    id: partial.id ?? `id-${partial.key}`,
    key: partial.key,
    value: partial.value,
    description: partial.description ?? '',
    enabled: partial.enabled ?? true,
  }
}

describe('rowsToBulkText', () => {
  it('serializes enabled and disabled rows with // prefix', () => {
    const rows = [
      row({ key: 'X-Auth', value: 'abc' }),
      row({ key: 'X-Trace', value: 'xyz', enabled: false }),
    ]
    expect(rowsToBulkText(rows)).toBe('X-Auth:abc\n//X-Trace:xyz')
  })

  it('drops empty placeholder rows (no key, no value)', () => {
    const rows = [
      row({ key: 'A', value: '1' }),
      row({ key: '', value: '' }),
      row({ key: 'B', value: '2' }),
    ]
    expect(rowsToBulkText(rows)).toBe('A:1\nB:2')
  })

  it('preserves colons inside values', () => {
    const rows = [row({ key: 'Authorization', value: 'Bearer a:b:c' })]
    expect(rowsToBulkText(rows)).toBe('Authorization:Bearer a:b:c')
  })

  it('returns empty string for empty list', () => {
    expect(rowsToBulkText([])).toBe('')
  })
})

describe('bulkTextToRows', () => {
  it('parses enabled and disabled rows', () => {
    const out = bulkTextToRows('X-Auth:abc\n//X-Trace:xyz')
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ key: 'X-Auth', value: 'abc', enabled: true })
    expect(out[1]).toMatchObject({ key: 'X-Trace', value: 'xyz', enabled: false })
  })

  it('treats lines without colon as key-only with empty value', () => {
    const out = bulkTextToRows('X-Token')
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ key: 'X-Token', value: '', enabled: true })
  })

  it('keeps colons in values (first colon is the separator)', () => {
    const out = bulkTextToRows('Authorization:Bearer a:b:c')
    expect(out[0]).toMatchObject({ key: 'Authorization', value: 'Bearer a:b:c' })
  })

  it('skips blank lines and trims trailing whitespace', () => {
    const out = bulkTextToRows('\nA:1   \n\n//B:2\n')
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ key: 'A', value: '1', enabled: true })
    expect(out[1]).toMatchObject({ key: 'B', value: '2', enabled: false })
  })

  it('generates a unique id per row', () => {
    const out = bulkTextToRows('A:1\nB:2\nC:3')
    const ids = out.map((r) => r.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('returns empty array for empty text', () => {
    expect(bulkTextToRows('')).toEqual([])
  })
})

describe('description preservation on round-trip', () => {
  it('preserves descriptions when keys are unchanged', () => {
    const previous = [
      row({ key: 'Authorization', value: 'old', description: 'auth header' }),
      row({ key: 'X-Trace', value: 'abc', description: 'trace id' }),
    ]
    const text = 'Authorization:new\nX-Trace:abc'
    const out = bulkTextToRows(text, previous)
    expect(out[0].description).toBe('auth header')
    expect(out[1].description).toBe('trace id')
  })

  it('preserves descriptions when rows are reordered', () => {
    const previous = [
      row({ key: 'A', value: '1', description: 'first' }),
      row({ key: 'B', value: '2', description: 'second' }),
    ]
    const out = bulkTextToRows('B:2\nA:1', previous)
    expect(out[0]).toMatchObject({ key: 'B', description: 'second' })
    expect(out[1]).toMatchObject({ key: 'A', description: 'first' })
  })

  it('preserves descriptions when only value changes', () => {
    const previous = [row({ key: 'X-Auth', value: 'old', description: 'kept' })]
    const out = bulkTextToRows('X-Auth:new', previous)
    expect(out[0]).toMatchObject({ key: 'X-Auth', value: 'new', description: 'kept' })
  })

  it('preserves descriptions when toggling enabled state', () => {
    const previous = [row({ key: 'X-Auth', value: 'a', description: 'd', enabled: true })]
    const out = bulkTextToRows('//X-Auth:a', previous)
    expect(out[0]).toMatchObject({ key: 'X-Auth', enabled: false, description: 'd' })
  })

  it('drops description for keys removed from text', () => {
    const previous = [
      row({ key: 'Keep', value: '1', description: 'k' }),
      row({ key: 'Drop', value: '2', description: 'gone' }),
    ]
    const out = bulkTextToRows('Keep:1', previous)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ key: 'Keep', description: 'k' })
  })

  it('uses empty description for keys not present in previous', () => {
    const previous = [row({ key: 'A', value: '1', description: 'desc-a' })]
    const out = bulkTextToRows('A:1\nNew:2', previous)
    expect(out[0].description).toBe('desc-a')
    expect(out[1].description).toBe('')
  })

  it('handles duplicate keys in FIFO order', () => {
    const previous = [
      row({ key: 'Set-Cookie', value: 'a', description: 'first cookie' }),
      row({ key: 'Set-Cookie', value: 'b', description: 'second cookie' }),
    ]
    const out = bulkTextToRows('Set-Cookie:a\nSet-Cookie:b', previous)
    expect(out[0].description).toBe('first cookie')
    expect(out[1].description).toBe('second cookie')
  })

  it('returns empty descriptions when previous is omitted', () => {
    const out = bulkTextToRows('A:1\nB:2')
    expect(out.map((r) => r.description)).toEqual(['', ''])
  })

  it('round-trips full row list preserving descriptions', () => {
    const original: KeyValuePair[] = [
      row({ key: 'A', value: '1', description: 'desc-a' }),
      row({ key: 'B', value: '2', description: 'desc-b', enabled: false }),
    ]
    const text = rowsToBulkText(original)
    const restored = bulkTextToRows(text, original)
    expect(restored).toHaveLength(2)
    expect(restored[0]).toMatchObject({
      key: 'A',
      value: '1',
      description: 'desc-a',
      enabled: true,
    })
    expect(restored[1]).toMatchObject({
      key: 'B',
      value: '2',
      description: 'desc-b',
      enabled: false,
    })
  })
})
