import { describe, it, expect } from 'vitest'
import {
  JSONPATH_EXAMPLES,
  evaluateJsonPath,
} from '../../../src/renderer/lib/tools/jsonpath'
import { XPATH_EXAMPLES, evaluateXPath } from '../../../src/renderer/lib/tools/xpath'
import { JOLT_EXAMPLES, transformJolt } from '../../../src/renderer/lib/tools/jolt'
import { XSLT_EXAMPLES, transformXslt } from '../../../src/renderer/lib/tools/xslt'

// Each "load sample" entry must be runnable end-to-end. These smoke tests
// catch typos and copy/paste regressions in the sample data.

describe('JSONPATH_EXAMPLES smoke', () => {
  it('every sample evaluates without errors', () => {
    expect(JSONPATH_EXAMPLES.length).toBeGreaterThanOrEqual(15)
    for (const ex of JSONPATH_EXAMPLES) {
      expect(ex.json, `sample "${ex.label}" missing json`).toBeTypeOf('string')
      const r = evaluateJsonPath(ex.json!, ex.path)
      expect(r.ok, `sample "${ex.label}" failed: ${!r.ok ? r.error : ''}`).toBe(true)
    }
  })

  it('sample 1 ("authors of all books") returns 4 authors', () => {
    const ex = JSONPATH_EXAMPLES.find((e) => e.path === '$.store.book[*].author')!
    const r = evaluateJsonPath(ex.json!, ex.path)
    if (!r.ok) throw new Error(r.error)
    expect(r.matches).toEqual([
      'Nigel Rees',
      'Evelyn Waugh',
      'Herman Melville',
      'J. R. R. Tolkien',
    ])
  })

  it('sample for ISBN filter returns only books with isbn', () => {
    const ex = JSONPATH_EXAMPLES.find((e) => e.path === '$..book[?(@.isbn)]')!
    const r = evaluateJsonPath(ex.json!, ex.path)
    if (!r.ok) throw new Error(r.error)
    expect(r.matches.length).toBe(2)
  })
})

describe('XPATH_EXAMPLES smoke', () => {
  it('every sample evaluates without errors', () => {
    expect(XPATH_EXAMPLES.length).toBeGreaterThanOrEqual(8)
    for (const ex of XPATH_EXAMPLES) {
      const r = evaluateXPath(ex.xml!, ex.expression)
      expect(r.ok, `sample "${ex.label}" failed: ${!r.ok ? r.error : ''}`).toBe(true)
    }
  })

  it('first-book sample returns exactly one node', () => {
    const ex = XPATH_EXAMPLES.find((e) => e.expression === '/bookstore/book[1]')!
    const r = evaluateXPath(ex.xml!, ex.expression)
    if (!r.ok) throw new Error(r.error)
    expect(r.kind).toBe('nodes')
    if (r.kind === 'nodes') expect(r.count).toBe(1)
  })

  it('lang="en" sample returns 3 titles (3 books with lang="en")', () => {
    const ex = XPATH_EXAMPLES.find((e) => e.expression === '//title[@lang="en"]')!
    const r = evaluateXPath(ex.xml!, ex.expression)
    if (!r.ok) throw new Error(r.error)
    if (r.kind === 'nodes') expect(r.count).toBe(3)
  })
})

describe('JOLT_EXAMPLES smoke', () => {
  it('every sample transforms without errors', () => {
    expect(JOLT_EXAMPLES.length).toBeGreaterThanOrEqual(10)
    for (const ex of JOLT_EXAMPLES) {
      const r = transformJolt(ex.input, ex.spec)
      expect(r.ok, `sample "${ex.label}" failed: ${!r.ok ? r.error : ''}`).toBe(true)
    }
  })

  it('Inception sample relocates nested rating fields', () => {
    const ex = JOLT_EXAMPLES.find((e) => e.label.startsWith('1.'))!
    const r = transformJolt(ex.input, ex.spec)
    if (!r.ok) throw new Error(r.error)
    const out = r.output as { Rating?: number; SecondaryRatings?: unknown }
    expect(out.Rating).toBe(3)
    expect(out.SecondaryRatings).toBeDefined()
  })

  it('default sample fills in missing fields', () => {
    const ex = JOLT_EXAMPLES.find((e) => e.label.startsWith('11.'))!
    const r = transformJolt(ex.input, ex.spec)
    if (!r.ok) throw new Error(r.error)
    const out = r.output as { user: { active: boolean; role: string } }
    expect(out.user.active).toBe(true)
    expect(out.user.role).toBe('guest')
  })

  it('remove sample drops the targeted field', () => {
    const ex = JOLT_EXAMPLES.find((e) => e.label.startsWith('10.'))!
    const r = transformJolt(ex.input, ex.spec)
    if (!r.ok) throw new Error(r.error)
    const out = r.output as { user: Record<string, unknown> }
    expect(out.user.secret).toBeUndefined()
    expect(out.user.name).toBe('Alice')
  })
})

describe('XSLT_EXAMPLES smoke', () => {
  it('every sample transforms without errors', async () => {
    expect(XSLT_EXAMPLES.length).toBeGreaterThanOrEqual(6)
    for (const ex of XSLT_EXAMPLES) {
      const r = await transformXslt(ex.xml, ex.xsl)
      expect(r.ok, `sample "${ex.label}" failed: ${!r.ok ? r.error : ''}`).toBe(true)
    }
  })

  it('first-element extract sample produces non-empty output', async () => {
    const ex = XSLT_EXAMPLES.find((e) => e.label.startsWith('1.'))!
    const r = await transformXslt(ex.xml, ex.xsl)
    if (!r.ok) throw new Error(r.error)
    expect(r.output.trim().length).toBeGreaterThan(0)
  })
})
