import { describe, it, expect } from 'vitest'
import {
  detectVersion,
  generateUuids,
  isValidUuid,
  UUID_NAMESPACES,
} from '../../../src/renderer/lib/tools/uuid'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

describe('generateUuids — v4', () => {
  it('produces a single canonical UUID by default', () => {
    const r = generateUuids('v4')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.uuids).toHaveLength(1)
    expect(r.uuids[0]).toMatch(UUID_RE)
  })

  it('respects the count option', () => {
    const r = generateUuids('v4', { count: 25 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.uuids).toHaveLength(25)
    expect(new Set(r.uuids).size).toBe(25) // all unique
  })

  it('clamps count between 1 and 1000', () => {
    expect(generateUuids('v4', { count: 0 }).ok).toBe(true)
    const r = generateUuids('v4', { count: 5000 })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.uuids).toHaveLength(1000)
  })
})

describe('generateUuids — formatting', () => {
  it('upper case', () => {
    const r = generateUuids('v4', { format: 'upper' })
    if (!r.ok) throw new Error(r.error)
    expect(r.uuids[0]).toBe(r.uuids[0].toUpperCase())
  })
  it('no dashes', () => {
    const r = generateUuids('v4', { format: 'noDashes' })
    if (!r.ok) throw new Error(r.error)
    expect(r.uuids[0]).not.toContain('-')
    expect(r.uuids[0]).toMatch(/^[0-9a-f]{32}$/)
  })
  it('urn prefix', () => {
    const r = generateUuids('v4', { format: 'urn' })
    if (!r.ok) throw new Error(r.error)
    expect(r.uuids[0]).toMatch(/^urn:uuid:/)
  })
  it('braces', () => {
    const r = generateUuids('v4', { format: 'braces' })
    if (!r.ok) throw new Error(r.error)
    expect(r.uuids[0]).toMatch(/^\{[0-9a-f-]+\}$/)
  })
})

describe('generateUuids — v5 deterministic', () => {
  it('same (namespace, name) gives the same UUID', () => {
    const r1 = generateUuids('v5', { namespace: UUID_NAMESPACES.DNS, name: 'example.com' })
    const r2 = generateUuids('v5', { namespace: UUID_NAMESPACES.DNS, name: 'example.com' })
    expect(r1.ok && r2.ok).toBe(true)
    if (r1.ok && r2.ok) expect(r1.uuids[0]).toBe(r2.uuids[0])
  })

  it('rejects missing namespace / name', () => {
    expect(generateUuids('v5', { name: 'x' }).ok).toBe(false)
    expect(generateUuids('v5', { namespace: UUID_NAMESPACES.DNS }).ok).toBe(false)
  })

  it('rejects an invalid namespace UUID', () => {
    const r = generateUuids('v5', { namespace: 'not-a-uuid', name: 'x' })
    expect(r.ok).toBe(false)
  })
})

describe('generateUuids — v1 / v7', () => {
  it('v1 produces a valid UUID', () => {
    const r = generateUuids('v1')
    if (!r.ok) throw new Error(r.error)
    expect(r.uuids[0]).toMatch(UUID_RE)
  })
  it('v7 produces a valid UUID', () => {
    const r = generateUuids('v7')
    if (!r.ok) throw new Error(r.error)
    expect(r.uuids[0]).toMatch(UUID_RE)
  })
  it('v7 UUIDs are roughly time-ordered', () => {
    const r = generateUuids('v7', { count: 50 })
    if (!r.ok) throw new Error(r.error)
    // Strip dashes, compare lexicographically: v7 sorts by time prefix.
    const sorted = [...r.uuids].sort()
    expect(r.uuids).toEqual(sorted)
  })
})

describe('isValidUuid + detectVersion', () => {
  it('detects v4', () => {
    const r = generateUuids('v4')
    if (!r.ok) throw new Error(r.error)
    expect(isValidUuid(r.uuids[0])).toBe(true)
    expect(detectVersion(r.uuids[0])).toBe(4)
  })

  it('strips urn / braces wrappers', () => {
    const r = generateUuids('v4', { format: 'urn' })
    if (!r.ok) throw new Error(r.error)
    expect(isValidUuid(r.uuids[0])).toBe(true)

    const r2 = generateUuids('v4', { format: 'braces' })
    if (!r2.ok) throw new Error(r2.error)
    expect(isValidUuid(r2.uuids[0])).toBe(true)
  })

  it('rejects garbage', () => {
    expect(isValidUuid('hello world')).toBe(false)
    expect(detectVersion('hello world')).toBeNull()
  })
})
