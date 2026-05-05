import { describe, it, expect } from 'vitest'
import { transformJolt } from '../../../src/renderer/lib/tools/jolt'

describe('transformJolt — shift', () => {
  it('renames a top-level field', () => {
    const r = transformJolt(
      JSON.stringify({ name: 'Alice', age: 30 }),
      JSON.stringify([{ operation: 'shift', spec: { name: 'firstName', age: 'years' } }]),
    )
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.output).toEqual({ firstName: 'Alice', years: 30 })
  })

  it('moves a nested field to top-level', () => {
    const r = transformJolt(
      JSON.stringify({ user: { id: 7, email: 'a@b.com' } }),
      JSON.stringify([
        { operation: 'shift', spec: { user: { id: 'userId', email: 'userEmail' } } },
      ]),
    )
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.output).toEqual({ userId: 7, userEmail: 'a@b.com' })
  })

  it('places to nested path', () => {
    const r = transformJolt(
      JSON.stringify({ id: 1 }),
      JSON.stringify([{ operation: 'shift', spec: { id: 'meta.identifier' } }]),
    )
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.output).toEqual({ meta: { identifier: 1 } })
  })

  it('wildcard * captures any key', () => {
    const r = transformJolt(
      JSON.stringify({ a: 1, b: 2, c: 3 }),
      JSON.stringify([{ operation: 'shift', spec: { '*': 'all.&0' } }]),
    )
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.output).toEqual({ all: { a: 1, b: 2, c: 3 } })
  })

  it('handles arrays', () => {
    const r = transformJolt(
      JSON.stringify({ tags: ['a', 'b', 'c'] }),
      JSON.stringify([{ operation: 'shift', spec: { tags: { '*': 'newTags.&0' } } }]),
    )
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.output).toEqual({ newTags: { '0': 'a', '1': 'b', '2': 'c' } })
  })
})

describe('transformJolt — default', () => {
  it('fills in missing fields without overwriting existing ones', () => {
    const r = transformJolt(
      JSON.stringify({ name: 'Alice' }),
      JSON.stringify([{ operation: 'default', spec: { name: 'Default', age: 0 } }]),
    )
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.output).toEqual({ name: 'Alice', age: 0 })
  })

  it('recurses into nested objects', () => {
    const r = transformJolt(
      JSON.stringify({ user: { name: 'Alice' } }),
      JSON.stringify([{ operation: 'default', spec: { user: { name: 'Default', age: 0 } } }]),
    )
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.output).toEqual({ user: { name: 'Alice', age: 0 } })
  })

  it('preserves existing nested values', () => {
    const r = transformJolt(
      JSON.stringify({ user: { age: 25 } }),
      JSON.stringify([{ operation: 'default', spec: { user: { name: 'Default' } } }]),
    )
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.output).toEqual({ user: { age: 25, name: 'Default' } })
  })
})

describe('transformJolt — remove', () => {
  it('removes a top-level field', () => {
    const r = transformJolt(
      JSON.stringify({ name: 'Alice', secret: 'xyz' }),
      JSON.stringify([{ operation: 'remove', spec: { secret: '' } }]),
    )
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.output).toEqual({ name: 'Alice' })
  })

  it('removes nested fields', () => {
    const r = transformJolt(
      JSON.stringify({ user: { name: 'Alice', password: 'pwd' } }),
      JSON.stringify([{ operation: 'remove', spec: { user: { password: '' } } }]),
    )
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.output).toEqual({ user: { name: 'Alice' } })
  })

  it('removes from each array element', () => {
    const r = transformJolt(
      JSON.stringify({ users: [{ name: 'A', secret: 1 }, { name: 'B', secret: 2 }] }),
      JSON.stringify([{ operation: 'remove', spec: { users: { secret: '' } } }]),
    )
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.output).toEqual({ users: [{ name: 'A' }, { name: 'B' }] })
  })

  it('ignores fields not present', () => {
    const r = transformJolt(
      JSON.stringify({ a: 1 }),
      JSON.stringify([{ operation: 'remove', spec: { nonexistent: '' } }]),
    )
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.output).toEqual({ a: 1 })
  })
})

describe('transformJolt — pipeline', () => {
  it('applies multiple operations in order', () => {
    const r = transformJolt(
      JSON.stringify({ name: 'Alice', secret: 'xyz' }),
      JSON.stringify([
        { operation: 'remove', spec: { secret: '' } },
        { operation: 'default', spec: { age: 0 } },
        { operation: 'shift', spec: { name: 'fullName', age: 'years' } },
      ]),
    )
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.output).toEqual({ fullName: 'Alice', years: 0 })
  })
})

describe('transformJolt — error handling', () => {
  it('rejects invalid input JSON', () => {
    const r = transformJolt('not-json', JSON.stringify([]))
    expect(r.ok).toBe(false)
  })

  it('rejects invalid spec JSON', () => {
    const r = transformJolt('{}', 'not-json')
    expect(r.ok).toBe(false)
  })

  it('rejects spec that is not an array', () => {
    const r = transformJolt('{}', JSON.stringify({ operation: 'shift', spec: {} }))
    expect(r.ok).toBe(false)
  })

  it('rejects unsupported operation', () => {
    const r = transformJolt(
      '{}',
      JSON.stringify([{ operation: 'modify', spec: {} }]),
    )
    expect(r.ok).toBe(false)
  })
})
