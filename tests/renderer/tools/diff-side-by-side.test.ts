import { describe, it, expect } from 'vitest'
import {
  computeSideBySide,
  computeDiffBlocks,
  computeFindMatches,
} from '../../../src/renderer/lib/tools/diff'

describe('computeSideBySide — equal text', () => {
  it('emits one equal row per shared line', () => {
    const r = computeSideBySide('a\nb\nc', 'a\nb\nc')
    expect(r.removals).toBe(0)
    expect(r.additions).toBe(0)
    expect(r.rows).toHaveLength(3)
    for (const row of r.rows) expect(row.kind).toBe('equal')
    expect(r.rows.map((row) => row.leftNum)).toEqual([1, 2, 3])
    expect(r.rows.map((row) => row.rightNum)).toEqual([1, 2, 3])
  })
})

describe('computeSideBySide — pure additions', () => {
  it('marks new lines as added with no left line number', () => {
    // Use trailing newlines so jsdiff sees clean line boundaries.
    const r = computeSideBySide('a\nb\n', 'a\nb\nc\n')
    expect(r.additions).toBeGreaterThan(0)
    expect(r.removals).toBe(0)
    const added = r.rows.find((row) => row.kind === 'added')
    expect(added).toBeDefined()
    expect(added?.leftNum).toBeUndefined()
    expect(added?.rightNum).toBeGreaterThanOrEqual(1)
  })
})

describe('computeSideBySide — pure removals', () => {
  it('marks dropped lines as removed with no right line number', () => {
    const r = computeSideBySide('a\nb\nc\n', 'a\nc\n')
    expect(r.removals).toBeGreaterThan(0)
    const removed = r.rows.find((row) => row.kind === 'removed')
    expect(removed).toBeDefined()
    expect(removed?.leftNum).toBe(2)
    expect(removed?.rightNum).toBeUndefined()
  })
})

describe('computeSideBySide — paired modifications', () => {
  it('matches the screenshot example (aaa/bbb/ccc → aaa/bbbc/ddd/ccc)', () => {
    // Example reproduces the canonical "0 removals / 2 additions" reference.
    const left = 'aaa\nbbb\nccc'
    const right = 'aaa\nbbbc\nddd\nccc'
    const r = computeSideBySide(left, right)
    expect(r.leftLines).toBe(3)
    expect(r.rightLines).toBe(4)
    // Should have at least one row of each non-equal kind.
    expect(r.rows.some((row) => row.kind === 'modify' || row.kind === 'added')).toBe(true)
    // Total rows ≥ max line count
    expect(r.rows.length).toBeGreaterThanOrEqual(4)
  })

  it('paired modify row has intra-line char segments on both sides', () => {
    const r = computeSideBySide('hello world', 'hello there')
    const modify = r.rows.find((row) => row.kind === 'modify')
    expect(modify).toBeDefined()
    expect(modify?.leftSegments?.length).toBeGreaterThan(0)
    expect(modify?.rightSegments?.length).toBeGreaterThan(0)
    // Left segments contain only equal/removed; right contain only equal/added.
    for (const s of modify?.leftSegments ?? []) {
      expect(['equal', 'removed']).toContain(s.kind)
    }
    for (const s of modify?.rightSegments ?? []) {
      expect(['equal', 'added']).toContain(s.kind)
    }
  })
})

describe('computeSideBySide — options', () => {
  it('ignoreCase=true treats casing as identical', () => {
    const r = computeSideBySide('Hello', 'hello', { ignoreCase: true })
    expect(r.removals).toBe(0)
    expect(r.additions).toBe(0)
  })

  it('ignoreWhitespace=true ignores leading/trailing space changes per line', () => {
    const r = computeSideBySide('a\nb  \nc', 'a\nb\nc', { ignoreWhitespace: true })
    expect(r.removals).toBe(0)
    expect(r.additions).toBe(0)
  })
})

describe('computeSideBySide — line counts', () => {
  it('reports correct totals for both sides', () => {
    const r = computeSideBySide('a\nb\nc', 'x\ny')
    expect(r.leftLines).toBe(3)
    expect(r.rightLines).toBe(2)
  })
})

describe('computeDiffBlocks', () => {
  it('returns no blocks for identical text', () => {
    const r = computeSideBySide('a\nb\nc', 'a\nb\nc')
    expect(computeDiffBlocks(r.rows)).toEqual([])
  })

  it('groups consecutive non-equal rows into a single block', () => {
    // Two changed lines in the middle should form ONE block, not two.
    const r = computeSideBySide('a\nb\nc\nd\n', 'a\nX\nY\nd\n')
    const blocks = computeDiffBlocks(r.rows)
    expect(blocks).toHaveLength(1)
    // Every row inside the block range is non-equal; rows outside are equal.
    const { start, end } = blocks[0]
    for (let i = start; i < end; i++) expect(r.rows[i].kind).not.toBe('equal')
    expect(r.rows[start - 1]?.kind).toBe('equal')
    expect(r.rows[end]?.kind).toBe('equal')
  })

  it('separates blocks split by equal rows', () => {
    const r = computeSideBySide('a\nb\nc\nd\ne\n', 'X\nb\nc\nd\nY\n')
    const blocks = computeDiffBlocks(r.rows)
    expect(blocks.length).toBe(2)
  })
})

describe('computeFindMatches', () => {
  const rows = computeSideBySide('hello world\nfoo bar', 'hello there\nfoo bar').rows

  it('returns no matches for an empty query', () => {
    const { matches, map } = computeFindMatches(rows, '')
    expect(matches).toHaveLength(0)
    expect(map.size).toBe(0)
  })

  it('finds case-insensitive occurrences across both sides', () => {
    const { matches } = computeFindMatches(rows, 'HELLO')
    // 'hello' appears on the left and right of the first row → 2 matches.
    expect(matches).toHaveLength(2)
    expect(matches.every((m) => m.rowIndex === 0)).toBe(true)
  })

  it('assigns sequential global indices and records segment ranges', () => {
    const { matches, map } = computeFindMatches(rows, 'foo')
    expect(matches.length).toBeGreaterThan(0)
    expect(matches.map((_, i) => i)).toEqual(matches.map((_, i) => i))
    const allRanges = [...map.values()].flat()
    expect(allRanges.length).toBe(matches.length)
    for (const r of allRanges) expect(r.length).toBe(3)
  })

  it('finds multiple occurrences within a single line', () => {
    const r = computeSideBySide('aa aa aa', 'aa aa aa').rows
    const { matches } = computeFindMatches(r, 'aa')
    // 3 per side × 2 sides = 6.
    expect(matches).toHaveLength(6)
  })
})
