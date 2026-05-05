import { describe, it, expect } from 'vitest'
import { evaluateJsonPath } from '../../../src/renderer/lib/tools/jsonpath'

const SAMPLE = JSON.stringify({
  store: {
    book: [
      { category: 'reference', author: 'Nigel Rees', title: 'Sayings', price: 8.95 },
      { category: 'fiction', author: 'Evelyn Waugh', title: 'Sword of Honour', price: 12.99 },
      { category: 'fiction', author: 'Herman Melville', title: 'Moby Dick', price: 8.99 },
    ],
    bicycle: { color: 'red', price: 19.95 },
  },
})

describe('evaluateJsonPath — basic', () => {
  it('root selector returns full document', () => {
    const r = evaluateJsonPath(SAMPLE, '$')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.matches).toHaveLength(1)
  })

  it('property descent', () => {
    const r = evaluateJsonPath(SAMPLE, '$.store.bicycle.color')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.matches).toEqual(['red'])
  })

  it('array element access', () => {
    const r = evaluateJsonPath(SAMPLE, '$.store.book[0].title')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.matches).toEqual(['Sayings'])
  })

  it('all authors via wildcard', () => {
    const r = evaluateJsonPath(SAMPLE, '$.store.book[*].author')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.matches).toEqual(['Nigel Rees', 'Evelyn Waugh', 'Herman Melville'])
  })

  it('recursive descent finds every price', () => {
    const r = evaluateJsonPath(SAMPLE, '$..price')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.matches).toContain(19.95)
  })

  it('filter expression — price < 10', () => {
    const r = evaluateJsonPath(SAMPLE, '$.store.book[?(@.price < 10)].title')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.matches.sort()).toEqual(['Moby Dick', 'Sayings'])
  })

  it('returns paths alongside matches', () => {
    const r = evaluateJsonPath(SAMPLE, '$.store.book[*].author')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.paths.length).toBe(r.matches.length)
  })
})

describe('evaluateJsonPath — error handling', () => {
  it('rejects empty expression', () => {
    expect(evaluateJsonPath(SAMPLE, '').ok).toBe(false)
    expect(evaluateJsonPath(SAMPLE, '   ').ok).toBe(false)
  })

  it('rejects invalid JSON input', () => {
    const r = evaluateJsonPath('not-json', '$')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('Invalid JSON')
  })

  it('returns empty matches for non-matching path', () => {
    const r = evaluateJsonPath(SAMPLE, '$.nonexistent.path')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.matches).toEqual([])
  })
})
