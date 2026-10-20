/**
 * Issue #221 (Faz 1a) — `src/shared/mock-stream.ts`: the SSE stream settings
 * of a mock response. Tolerant read (never throws, defaults + clamping) and a
 * strict save-time check.
 */
import { describe, it, expect } from 'vitest'
import {
  SSE_MAX_INTERVAL_MS,
  SSE_MIN_LOOP_INTERVAL_MS,
  SSE_STREAM_DEFAULTS,
  normalizeStreamConfig,
  validateStreamConfig,
} from '../../../src/shared/mock-stream'

describe('normalizeStreamConfig', () => {
  it('null / undefined / corrupt JSON / non-object → the defaults', () => {
    for (const raw of [null, undefined, '{nope', '[1,2]', 42, 'x', [], true]) {
      expect(normalizeStreamConfig(raw)).toEqual(SSE_STREAM_DEFAULTS)
    }
  })

  it('defaults: 1000 ms, no heartbeat, no loop, close at the end, resume on', () => {
    expect(SSE_STREAM_DEFAULTS).toEqual({
      intervalMs: 1000,
      heartbeatMs: 0,
      loop: false,
      onEnd: 'close',
      resume: true,
    })
  })

  it('reads a valid object and the same object as JSON text', () => {
    const cfg = {
      intervalMs: 250,
      heartbeatMs: 5000,
      loop: true,
      onEnd: 'keep-open',
      resume: false,
    }
    expect(normalizeStreamConfig(cfg)).toEqual(cfg)
    expect(normalizeStreamConfig(JSON.stringify(cfg))).toEqual(cfg)
  })

  it('missing keys take the defaults; wrong types fall back; unknown keys are dropped', () => {
    expect(
      normalizeStreamConfig({ intervalMs: '5', loop: 'yes', onEnd: 'later', kind: 'sse', x: 1 }),
    ).toEqual(SSE_STREAM_DEFAULTS)
    expect(normalizeStreamConfig({ intervalMs: 5 })).toEqual({
      ...SSE_STREAM_DEFAULTS,
      intervalMs: 5,
    })
  })

  it('clamps intervals into 0..600000 and rounds them', () => {
    expect(normalizeStreamConfig({ intervalMs: -5, heartbeatMs: 1e9 })).toMatchObject({
      intervalMs: 0,
      heartbeatMs: SSE_MAX_INTERVAL_MS,
    })
    expect(normalizeStreamConfig({ intervalMs: 12.6 }).intervalMs).toBe(13)
    expect(normalizeStreamConfig({ intervalMs: Number.NaN }).intervalMs).toBe(1000)
  })

  it('a looping stream never runs faster than the minimum interval', () => {
    expect(normalizeStreamConfig({ intervalMs: 0, loop: true }).intervalMs).toBe(
      SSE_MIN_LOOP_INTERVAL_MS,
    )
    expect(normalizeStreamConfig({ intervalMs: 0, loop: false }).intervalMs).toBe(0)
  })
})

describe('validateStreamConfig', () => {
  it('null / undefined / {} / partial / full valid objects pass', () => {
    expect(validateStreamConfig(null)).toBeNull()
    expect(validateStreamConfig(undefined)).toBeNull()
    expect(validateStreamConfig({})).toBeNull()
    expect(validateStreamConfig({ intervalMs: 0, loop: false })).toBeNull()
    expect(
      validateStreamConfig({
        intervalMs: 600000,
        heartbeatMs: 0,
        loop: true,
        onEnd: 'keep-open',
        resume: false,
      }),
    ).toBeNull()
  })

  it('names the problem', () => {
    expect(validateStreamConfig('x')).toBe('Stream settings must be an object')
    expect(validateStreamConfig([])).toBe('Stream settings must be an object')
    expect(validateStreamConfig({ kind: 'sse' })).toBe('Unknown stream setting: kind')
    expect(validateStreamConfig({ intervalMs: -1 })).toMatch(/^Event interval must be/)
    expect(validateStreamConfig({ intervalMs: 1.5 })).toMatch(/^Event interval must be/)
    expect(validateStreamConfig({ intervalMs: 600001 })).toMatch(/between 0 and 600000/)
    expect(validateStreamConfig({ heartbeatMs: '10' })).toMatch(/^Heartbeat interval must be/)
    expect(validateStreamConfig({ loop: 1 })).toBe('Loop must be true or false')
    expect(validateStreamConfig({ resume: 'no' })).toBe('Resume must be true or false')
    expect(validateStreamConfig({ onEnd: 'later' })).toMatch(/close or stay open/)
  })
})
