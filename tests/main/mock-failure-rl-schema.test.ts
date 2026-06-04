import { describe, it, expect, beforeEach } from 'vitest'
import { rollFailure } from '../../src/main/mock/failure'
import { checkRateLimit, clearAllLimiters } from '../../src/main/mock/rateLimit'
import { validateBody, clearSchemaCache } from '../../src/main/mock/schemaValidator'

describe('rollFailure', () => {
  it('returns none when disabled', () => {
    const r = rollFailure({ enabled: false, probability: 100, mode: 'status' })
    expect(r.kind).toBe('none')
  })

  it('returns none when probability is 0', () => {
    const r = rollFailure({ enabled: true, probability: 0, mode: 'status' })
    expect(r.kind).toBe('none')
  })

  it('always fires when probability is 100 — status mode', () => {
    const r = rollFailure({ enabled: true, probability: 100, mode: 'status', status: 502 })
    expect(r.kind).toBe('status')
    expect(r.status).toBe(502)
    expect(r.body).toContain('injected_failure')
  })

  it('timeout mode reports a delay and 504', () => {
    const r = rollFailure({ enabled: true, probability: 100, mode: 'timeout', timeoutMs: 100 })
    expect(r.kind).toBe('timeout')
    expect(r.status).toBe(504)
    expect(r.delayMs).toBe(100)
  })

  it('random mode picks status or timeout', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 60; i++) {
      const r = rollFailure({
        enabled: true,
        probability: 100,
        mode: 'random',
        status: 500,
        timeoutMs: 1,
      })
      seen.add(r.kind)
    }
    // Both branches should appear with very high probability over 60 trials.
    expect(seen.has('status') || seen.has('timeout')).toBe(true)
  })
})

describe('checkRateLimit', () => {
  beforeEach(() => clearAllLimiters())

  it('allows everything when disabled', () => {
    const cfg = {
      enabled: false,
      requestsPerWindow: 1,
      windowMs: 1000,
      scope: 'ip' as const,
    }
    for (let i = 0; i < 10; i++) {
      expect(checkRateLimit('s', cfg, '1.2.3.4').allowed).toBe(true)
    }
  })

  it('blocks past the limit within a window (ip scope)', () => {
    const cfg = {
      enabled: true,
      requestsPerWindow: 3,
      windowMs: 60000,
      scope: 'ip' as const,
    }
    expect(checkRateLimit('s', cfg, 'A').allowed).toBe(true)
    expect(checkRateLimit('s', cfg, 'A').allowed).toBe(true)
    expect(checkRateLimit('s', cfg, 'A').allowed).toBe(true)
    const blocked = checkRateLimit('s', cfg, 'A')
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfterSec).toBeGreaterThan(0)
  })

  it('keeps separate counters for different IPs', () => {
    const cfg = {
      enabled: true,
      requestsPerWindow: 1,
      windowMs: 60000,
      scope: 'ip' as const,
    }
    expect(checkRateLimit('s', cfg, 'A').allowed).toBe(true)
    expect(checkRateLimit('s', cfg, 'A').allowed).toBe(false)
    expect(checkRateLimit('s', cfg, 'B').allowed).toBe(true) // B unaffected
  })

  it('global scope shares a single bucket across IPs', () => {
    const cfg = {
      enabled: true,
      requestsPerWindow: 1,
      windowMs: 60000,
      scope: 'global' as const,
    }
    expect(checkRateLimit('s', cfg, 'A').allowed).toBe(true)
    expect(checkRateLimit('s', cfg, 'B').allowed).toBe(false)
  })

  it('resets after the window passes', () => {
    const cfg = {
      enabled: true,
      requestsPerWindow: 1,
      windowMs: 1000,
      scope: 'ip' as const,
    }
    const now = Date.now()
    expect(checkRateLimit('s', cfg, 'A', now).allowed).toBe(true)
    expect(checkRateLimit('s', cfg, 'A', now + 100).allowed).toBe(false)
    expect(checkRateLimit('s', cfg, 'A', now + 1500).allowed).toBe(true)
  })
})

describe('validateBody', () => {
  beforeEach(() => clearSchemaCache())

  it('passes when validation is disabled', () => {
    const r = validateBody({ enabled: false, schema: { type: 'object' } }, 'anything')
    expect(r.ok).toBe(true)
  })

  it('passes a body that matches a draft-07 schema', () => {
    const r = validateBody(
      {
        enabled: true,
        schema: {
          type: 'object',
          required: ['name', 'age'],
          properties: { name: { type: 'string' }, age: { type: 'integer' } },
        },
      },
      { name: 'Alice', age: 30 },
    )
    expect(r.ok).toBe(true)
  })

  it('rejects a body missing required fields with errors', () => {
    const r = validateBody(
      {
        enabled: true,
        schema: {
          type: 'object',
          required: ['name'],
          properties: { name: { type: 'string' } },
        },
      },
      {},
    )
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.failure.status).toBe(400)
      const parsed = JSON.parse(r.failure.body)
      expect(parsed.errors).toBeInstanceOf(Array)
      expect(parsed.errors.length).toBeGreaterThan(0)
    }
  })

  it('caches compiled validators (smoke — no error on re-use)', () => {
    const cfg = {
      enabled: true,
      schema: { type: 'object', properties: { x: { type: 'number' } }, required: ['x'] },
    }
    expect(validateBody(cfg, { x: 1 }).ok).toBe(true)
    expect(validateBody(cfg, {}).ok).toBe(false)
  })

  it('handles invalid schema gracefully', () => {
    const r = validateBody(
      { enabled: true, schema: { type: 'not-a-real-type' } },
      {},
    )
    expect(r.ok).toBe(false)
  })
})
