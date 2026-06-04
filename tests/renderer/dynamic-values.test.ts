import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { resolveDynamicValue } from '../../src/renderer/lib/dynamic-values'

describe('resolveDynamicValue', () => {
  describe('$timestamp', () => {
    it('returns unix seconds as numeric string', () => {
      const before = Math.floor(Date.now() / 1000)
      const result = resolveDynamicValue('$timestamp')
      const after = Math.floor(Date.now() / 1000)
      const ts = parseInt(result, 10)
      expect(ts).toBeGreaterThanOrEqual(before)
      expect(ts).toBeLessThanOrEqual(after)
    })
  })

  describe('$isoTimestamp', () => {
    it('returns valid ISO 8601 string', () => {
      const result = resolveDynamicValue('$isoTimestamp')
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
      expect(new Date(result).toISOString()).toBe(result)
    })
  })

  describe('$randomUUID', () => {
    it('returns v4-style UUID', () => {
      const result = resolveDynamicValue('$randomUUID')
      expect(result).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
    })

    it('generates different values on subsequent calls', () => {
      const a = resolveDynamicValue('$randomUUID')
      const b = resolveDynamicValue('$randomUUID')
      expect(a).not.toBe(b)
    })
  })

  describe('$randomInt', () => {
    it('without args returns 0-1000', () => {
      const result = parseInt(resolveDynamicValue('$randomInt'), 10)
      expect(result).toBeGreaterThanOrEqual(0)
      expect(result).toBeLessThanOrEqual(1000)
    })

    it('with range respects bounds', () => {
      for (let i = 0; i < 50; i++) {
        const result = parseInt(resolveDynamicValue('$randomInt(10,20)'), 10)
        expect(result).toBeGreaterThanOrEqual(10)
        expect(result).toBeLessThanOrEqual(20)
      }
    })

    it('with malformed args falls back to default range', () => {
      const result = parseInt(resolveDynamicValue('$randomInt(abc)'), 10)
      expect(result).toBeGreaterThanOrEqual(0)
      expect(result).toBeLessThanOrEqual(1000)
    })
  })

  describe('$randomString', () => {
    it('returns alphanumeric string of requested length', () => {
      const result = resolveDynamicValue('$randomString(16)')
      expect(result).toHaveLength(16)
      expect(result).toMatch(/^[A-Za-z0-9]+$/)
    })

    it('falls back to length 8 for invalid arg', () => {
      const result = resolveDynamicValue('$randomString(xyz)')
      expect(result).toHaveLength(8)
    })
  })

  describe('$randomEmail', () => {
    it('returns valid email format', () => {
      const result = resolveDynamicValue('$randomEmail')
      expect(result).toMatch(/^[a-z]+\.[a-z]+@[a-z.]+$/)
    })
  })

  describe('$randomName', () => {
    it('returns "First Last" format', () => {
      const result = resolveDynamicValue('$randomName')
      expect(result).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/)
    })
  })

  describe('$datetime', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-05-05T14:30:45.000Z'))
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('formats with YYYY-MM-DD pattern', () => {
      const result = resolveDynamicValue('$datetime(YYYY-MM-DD)')
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })

    it('formats with all tokens', () => {
      const result = resolveDynamicValue('$datetime(YYYY-MM-DD HH:mm:ss)')
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
    })

    it('strips quotes from format arg', () => {
      const result = resolveDynamicValue("$datetime('YYYY')")
      expect(result).toMatch(/^\d{4}$/)
    })
  })

  describe('unknown expressions', () => {
    it('returns expression as-is when unrecognized', () => {
      expect(resolveDynamicValue('$nonexistent')).toBe('$nonexistent')
    })

    it('returns expression as-is for unknown function', () => {
      expect(resolveDynamicValue('$unknownFn(arg)')).toBe('$unknownFn(arg)')
    })
  })
})
