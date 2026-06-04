import { describe, it, expect } from 'vitest'
import {
  STANDARD_HTTP_HEADERS,
  filterHeaderSuggestions,
  filterHeaderValueSuggestions,
  HEADER_VALUE_SUGGESTIONS,
} from '../../src/renderer/lib/http-headers'

describe('STANDARD_HTTP_HEADERS', () => {
  it('exports a deduplicated, non-empty list', () => {
    expect(STANDARD_HTTP_HEADERS.length).toBeGreaterThan(30)
    const unique = new Set(STANDARD_HTTP_HEADERS.map((h) => h.toLowerCase()))
    expect(unique.size).toBe(STANDARD_HTTP_HEADERS.length)
  })

  it('contains common request and response headers', () => {
    for (const expected of [
      'Accept',
      'Authorization',
      'Content-Type',
      'Cookie',
      'Set-Cookie',
      'Cache-Control',
      'X-Requested-With',
    ]) {
      expect(STANDARD_HTTP_HEADERS).toContain(expected)
    }
  })
})

describe('filterHeaderSuggestions', () => {
  it('returns no suggestions for empty input', () => {
    expect(filterHeaderSuggestions('')).toEqual([])
    expect(filterHeaderSuggestions('   ')).toEqual([])
  })

  it('matches case-insensitively by prefix', () => {
    const result = filterHeaderSuggestions('content-')
    expect(result).toContain('Content-Type')
    expect(result).toContain('Content-Length')
    expect(result).not.toContain('Authorization')
  })

  it('upper-cases the query and still matches', () => {
    const result = filterHeaderSuggestions('AUTH')
    expect(result).toContain('Authorization')
  })

  it('matches by substring, putting prefix matches first', () => {
    // v1.4.0: typing "forw" should surface both "Forwarded" (prefix match)
    // and "X-Forwarded-For"/"Authorization-Forwarded" (substring matches),
    // so users searching for a known header by its mid-word keyword
    // actually find it. Prefix matches stay at the top to keep the most
    // likely completion adjacent to the caret.
    const entries = ['X-Forwarded-For', 'Forwarded', 'Authorization-Forwarded']
    const result = filterHeaderSuggestions('forw', entries)
    expect(result[0]).toBe('Forwarded')
    expect(result).toContain('X-Forwarded-For')
    expect(result).toContain('Authorization-Forwarded')
  })

  it('finds Content-Type when the user types just "type"', () => {
    // The classic case from v1.3.1 §M2: "type" did not match "Content-Type".
    const result = filterHeaderSuggestions('type', ['Content-Type', 'Accept', 'Authorization'])
    expect(result).toContain('Content-Type')
  })

  it('preserves original ordering of matched entries', () => {
    const entries = ['Content-Type', 'Content-Length', 'Content-Disposition']
    const result = filterHeaderSuggestions('content-', entries)
    expect(result).toEqual(['Content-Type', 'Content-Length', 'Content-Disposition'])
  })

  it('omits an exact-match entry from the suggestions', () => {
    // No reason to "complete" a header the user has already typed in full.
    const result = filterHeaderSuggestions('Content-Type', ['Content-Type', 'Content-Length'])
    expect(result).not.toContain('Content-Type')
    expect(result).toEqual([])
  })

  it('returns an empty list when nothing matches', () => {
    expect(filterHeaderSuggestions('zzz-no-such-header')).toEqual([])
  })

  it('uses STANDARD_HTTP_HEADERS by default', () => {
    const result = filterHeaderSuggestions('accept')
    expect(result).toContain('Accept-Encoding')
    expect(result).toContain('Accept-Language')
  })
})

describe('filterHeaderValueSuggestions', () => {
  it('returns the full list when value is empty so focus can preview all options', () => {
    const result = filterHeaderValueSuggestions('Content-Type', '')
    expect(result).toContain('application/json')
    expect(result.length).toBe(HEADER_VALUE_SUGGESTIONS['content-type'].length)
  })

  it('matches header name case-insensitively', () => {
    expect(filterHeaderValueSuggestions('content-type', 'json')).toContain('application/json')
    expect(filterHeaderValueSuggestions('CONTENT-TYPE', 'json')).toContain('application/json')
  })

  it('substring-matches the value', () => {
    const result = filterHeaderValueSuggestions('Content-Type', 'json')
    expect(result).toEqual(['application/json'])
  })

  it('omits an exact match', () => {
    const result = filterHeaderValueSuggestions('Content-Type', 'application/json')
    expect(result).not.toContain('application/json')
  })

  it('returns an empty list for unrecognised header names', () => {
    expect(filterHeaderValueSuggestions('X-Custom-Header', '')).toEqual([])
    expect(filterHeaderValueSuggestions('', 'anything')).toEqual([])
  })

  it('covers other common headers', () => {
    expect(filterHeaderValueSuggestions('Accept', '')).toContain('application/json')
    expect(filterHeaderValueSuggestions('Cache-Control', 'no')).toContain('no-cache')
    expect(filterHeaderValueSuggestions('Connection', '')).toContain('keep-alive')
    expect(filterHeaderValueSuggestions('Authorization', '')).toEqual(
      expect.arrayContaining(['Bearer ', 'Basic ']),
    )
  })
})
