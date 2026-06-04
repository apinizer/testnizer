import { describe, it, expect } from 'vitest'
import { HTTP_STATUS_CODES } from '../../../src/renderer/lib/tools/http-status'

describe('HTTP_STATUS_CODES catalog', () => {
  it('contains every common HTTP status', () => {
    const codes = new Set(HTTP_STATUS_CODES.map((s) => s.code))
    for (const c of [
      100, 101, 200, 201, 204, 301, 302, 304, 400, 401, 403, 404, 405, 409, 410, 418, 422,
      429, 451, 500, 502, 503, 504,
    ]) {
      expect(codes.has(c)).toBe(true)
    }
  })

  it('every entry has matching category prefix and three-digit code', () => {
    for (const s of HTTP_STATUS_CODES) {
      expect(s.code).toBeGreaterThanOrEqual(100)
      expect(s.code).toBeLessThan(600)
      const expectedPrefix = `${Math.floor(s.code / 100)}xx`
      expect(s.category).toBe(expectedPrefix)
      expect(s.name.length).toBeGreaterThan(0)
      expect(s.description.length).toBeGreaterThan(0)
    }
  })

  it('codes are unique', () => {
    const codes = HTTP_STATUS_CODES.map((s) => s.code)
    expect(new Set(codes).size).toBe(codes.length)
  })

  it('category distribution covers all 5 buckets', () => {
    const cats = new Set(HTTP_STATUS_CODES.map((s) => s.category))
    expect(cats).toEqual(new Set(['1xx', '2xx', '3xx', '4xx', '5xx']))
  })

  it('418 is "I\'m a teapot" (RFC 2324, sanity check)', () => {
    const teapot = HTTP_STATUS_CODES.find((s) => s.code === 418)
    expect(teapot).toBeDefined()
    expect(teapot?.name.toLowerCase()).toContain('teapot')
  })
})
