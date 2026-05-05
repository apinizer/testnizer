import { describe, it, expect } from 'vitest'
import { computeDiff, renderUnifiedDiff } from '../../../src/renderer/lib/tools/diff'

describe('computeDiff — modes', () => {
  it('detects identical text as fully unchanged', () => {
    const r = computeDiff('hello', 'hello', { mode: 'lines' })
    expect(r.added).toBe(0)
    expect(r.removed).toBe(0)
    expect(r.changes.every((c) => !c.added && !c.removed)).toBe(true)
  })

  it('lines mode — added line', () => {
    const r = computeDiff('a\nb\n', 'a\nb\nc\n', { mode: 'lines' })
    expect(r.added).toBeGreaterThan(0)
    expect(r.removed).toBe(0)
  })

  it('lines mode — removed line', () => {
    const r = computeDiff('a\nb\nc\n', 'a\nc\n', { mode: 'lines' })
    expect(r.removed).toBeGreaterThan(0)
  })

  it('chars mode — character-level changes', () => {
    const r = computeDiff('abc', 'aXc', { mode: 'chars' })
    expect(r.added).toBeGreaterThan(0)
    expect(r.removed).toBeGreaterThan(0)
  })

  it('words mode — word-level changes', () => {
    const r = computeDiff('hello world', 'hello there', { mode: 'words' })
    expect(r.added).toBeGreaterThan(0)
    expect(r.removed).toBeGreaterThan(0)
  })

  it('default mode is lines', () => {
    const a = computeDiff('a\nb', 'a\nc')
    const b = computeDiff('a\nb', 'a\nc', { mode: 'lines' })
    expect(a.added).toBe(b.added)
    expect(a.removed).toBe(b.removed)
  })
})

describe('computeDiff — options', () => {
  it('ignoreCase treats different cases as identical', () => {
    const r = computeDiff('Hello', 'hello', { mode: 'chars', ignoreCase: true })
    expect(r.added).toBe(0)
    expect(r.removed).toBe(0)
  })

  it('without ignoreCase, case differences are detected', () => {
    const r = computeDiff('Hello', 'hello', { mode: 'chars' })
    expect(r.added + r.removed).toBeGreaterThan(0)
  })

  it('ignoreWhitespace (lines) — trailing whitespace ignored', () => {
    const r = computeDiff('hello   \nworld', 'hello\nworld', {
      mode: 'lines',
      ignoreWhitespace: true,
    })
    expect(r.added).toBe(0)
    expect(r.removed).toBe(0)
  })
})

describe('renderUnifiedDiff', () => {
  it('emits +/-/space prefixes', () => {
    const r = computeDiff('a\nb\n', 'a\nc\n')
    const rendered = renderUnifiedDiff(r)
    expect(rendered).toContain(' a')
    expect(rendered).toMatch(/[+-]/)
  })

  it('all-equal yields no +/- lines', () => {
    const r = computeDiff('hello', 'hello')
    const rendered = renderUnifiedDiff(r)
    expect(rendered).not.toMatch(/^[+-]/m)
  })
})

describe('computeDiff — edge cases', () => {
  it('empty vs non-empty', () => {
    const r = computeDiff('', 'hello\n')
    expect(r.added).toBeGreaterThan(0)
  })

  it('non-empty vs empty', () => {
    const r = computeDiff('hello\n', '')
    expect(r.removed).toBeGreaterThan(0)
  })

  it('both empty', () => {
    const r = computeDiff('', '')
    expect(r.added).toBe(0)
    expect(r.removed).toBe(0)
  })

  it('UTF-8 (Türkçe + emoji)', () => {
    const r = computeDiff('Yıldız', 'Yıldız 🚀', { mode: 'chars' })
    expect(r.added).toBeGreaterThan(0)
  })
})
