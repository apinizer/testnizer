/**
 * Issue #98 — the variables table's remove button wrapped onto a second line.
 *
 * `VarRowView` declared six grid tracks while rendering seven cells (enabled,
 * name, type, initial value, current value, copy, remove). CSS Grid put the
 * seventh on an implicit second line, so every row was about twice as tall as
 * the header implied and the × sat under the checkbox instead of in its own
 * column — worst in exactly the large-variable-set case issue #95 is about.
 *
 * The header row already declared seven, which is why header and rows looked
 * misaligned. This pins them to the SAME track list: a future column added to
 * one and not the other reproduces the bug, and the count check is what a
 * hard-coded string comparison would not catch.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const SRC = readFileSync(
  resolve(__dirname, '../../src/renderer/components/modals/EnvironmentModal.tsx'),
  'utf8',
)

/** Every `gridTemplateColumns: '…'` literal in the variables table. */
function trackLists(): string[] {
  return [...SRC.matchAll(/gridTemplateColumns:\s*'([^']+)'/g)].map((m) => m[1].trim())
}

describe('the variables table grid', () => {
  it('declares a track list for both the header and the rows', () => {
    expect(trackLists().length).toBeGreaterThanOrEqual(2)
  })

  it('gives every row the same tracks as its header', () => {
    // The bug was two DIFFERENT lists — six on the row, seven on the header.
    expect(new Set(trackLists()).size).toBe(1)
  })

  it('has one track per rendered cell, so nothing wraps to a second line', () => {
    // enabled · name · type · initial value · current value · copy · remove
    for (const list of trackLists()) {
      expect(list.split(/\s+/)).toHaveLength(7)
    }
  })
})
