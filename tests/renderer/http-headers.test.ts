import { describe, it, expect } from 'vitest'
import {
  STANDARD_HTTP_HEADERS,
  filterHeaderSuggestions,
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

  it('only matches by prefix, not by substring', () => {
    const entries = ['X-Forwarded-For', 'Forwarded', 'Authorization-Forwarded']
    const result = filterHeaderSuggestions('forw', entries)
    expect(result).toEqual(['Forwarded'])
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
