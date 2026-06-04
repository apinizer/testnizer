import { describe, it, expect } from 'vitest'
import { generateJsonSchema } from '../../../src/renderer/lib/tools/json-schema'

function schemaOf(json: unknown, opts = {}): Record<string, unknown> {
  const r = generateJsonSchema(JSON.stringify(json), opts)
  if (!r.ok) throw new Error(r.error)
  return r.schema as Record<string, unknown>
}

describe('generateJsonSchema — primitives', () => {
  it('detects integer vs number', () => {
    expect(schemaOf(42).type).toBe('integer')
    expect(schemaOf(3.14).type).toBe('number')
  })

  it('detects boolean and null', () => {
    expect(schemaOf(true).type).toBe('boolean')
    expect(schemaOf(null).type).toBe('null')
  })

  it('emits draft-07 $schema', () => {
    expect(schemaOf({}).$schema).toBe('http://json-schema.org/draft-07/schema#')
  })
})

describe('generateJsonSchema — objects', () => {
  it('describes properties and required keys when requiredAll', () => {
    const s = schemaOf({ name: 'Alice', age: 30 })
    expect(s.type).toBe('object')
    expect(s.properties).toMatchObject({
      name: { type: 'string' },
      age: { type: 'integer' },
    })
    expect(s.required).toEqual(['name', 'age'])
  })

  it('omits required when requiredAll=false', () => {
    const s = schemaOf({ name: 'Alice' }, { requiredAll: false })
    expect(s.required).toBeUndefined()
  })

  it('handles nested objects', () => {
    const s = schemaOf({ user: { id: 1 } })
    const props = s.properties as Record<string, Record<string, unknown>>
    expect((props.user as { type: string }).type).toBe('object')
  })
})

describe('generateJsonSchema — arrays', () => {
  it('uses single items schema when shape is uniform', () => {
    const s = schemaOf({ tags: ['a', 'b', 'c'] })
    const props = s.properties as Record<string, Record<string, unknown>>
    expect(props.tags.type).toBe('array')
    expect(props.tags.items).toEqual({ type: 'string' })
  })

  it('uses oneOf items when shapes diverge', () => {
    const s = schemaOf({ mixed: [1, 'two', true] })
    const props = s.properties as Record<string, Record<string, unknown>>
    const items = props.mixed.items as { oneOf: unknown[] }
    expect(items.oneOf.length).toBeGreaterThan(1)
  })

  it('handles empty arrays gracefully', () => {
    const s = schemaOf({ empty: [] })
    const props = s.properties as Record<string, Record<string, unknown>>
    expect(props.empty.type).toBe('array')
    expect(props.empty.items).toEqual({})
  })
})

describe('generateJsonSchema — string format detection', () => {
  it('detects email', () => {
    const s = schemaOf('alice@example.com')
    expect(s.format).toBe('email')
  })

  it('detects date', () => {
    const s = schemaOf('2025-01-01')
    expect(s.format).toBe('date')
  })

  it('detects date-time', () => {
    const s = schemaOf('2025-01-01T12:34:56Z')
    expect(s.format).toBe('date-time')
  })

  it('detects uuid', () => {
    const s = schemaOf('a3bb189e-8bf9-3888-9912-ace4e6543002')
    expect(s.format).toBe('uuid')
  })

  it('detects uri', () => {
    const s = schemaOf('https://example.com/path')
    expect(s.format).toBe('uri')
  })

  it('does not assign a format when detectFormats=false', () => {
    const s = schemaOf('alice@example.com', { detectFormats: false })
    expect(s.format).toBeUndefined()
  })

  it('leaves regular strings without format', () => {
    const s = schemaOf('just a sentence')
    expect(s.format).toBeUndefined()
  })
})

describe('generateJsonSchema — error handling', () => {
  it('reports invalid JSON', () => {
    const r = generateJsonSchema('{not json')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/Invalid JSON/)
  })
})
