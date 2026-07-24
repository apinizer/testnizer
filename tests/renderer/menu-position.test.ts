/**
 * Unit tests for the shared context-menu placement math (issues #58, #67).
 *
 * Every click-anchored menu in the renderer (APIs tree, Tests panel, tab bar)
 * routes through this one function, so the flip/clamp/scroll rules are pinned
 * here rather than per surface.
 */
import { describe, it, expect } from 'vitest'
import { positionContextMenu } from '../../src/renderer/lib/menu-position'

const VW = 1000
const VH = 800
const base = { width: 200, height: 300, viewportWidth: VW, viewportHeight: VH }

describe('positionContextMenu', () => {
  it('opens straight down when there is room', () => {
    expect(positionContextMenu({ ...base, x: 100, y: 100 })).toEqual({ left: 100, top: 100 })
  })

  it('flips up when the menu would overflow the bottom edge', () => {
    // roomBelow = 800 - 8 - 700 = 92 < 300, roomAbove = 692 ≥ 300 → top = y - h
    expect(positionContextMenu({ ...base, x: 100, y: 700 })).toEqual({ left: 100, top: 400 })
  })

  it('keeps the menu on screen at the very bottom edge', () => {
    const { top, maxHeight } = positionContextMenu({ ...base, x: 10, y: VH - 1 })
    expect(top).toBe(VH - 1 - 300)
    expect(top).toBeGreaterThanOrEqual(0)
    expect(maxHeight).toBeUndefined()
  })

  it('flips left when the menu would cross the right edge', () => {
    // 950 + 200 = 1150 > 992 → mirror around the cursor: 950 - 200 = 750
    expect(positionContextMenu({ ...base, x: 950, y: 100 })).toEqual({ left: 750, top: 100 })
  })

  it('hugs the right edge when even the flipped menu would leave the viewport', () => {
    // 500 + 900 overflows, and 500 - 900 = -400 < pad → clamp to 1000 - 900 - 8
    expect(positionContextMenu({ ...base, x: 500, y: 100, width: 900 }).left).toBe(92)
  })

  it('never resolves left of 0 for a menu wider than the viewport', () => {
    expect(positionContextMenu({ ...base, x: 500, y: 100, width: 1400 }).left).toBe(0)
  })

  it('flips on both axes for a bottom-right corner click', () => {
    expect(positionContextMenu({ ...base, x: 990, y: 790 })).toEqual({ left: 790, top: 490 })
  })

  it('slides up when neither anchor direction fits but the menu still does', () => {
    // y = 400 → roomBelow 392, roomAbove 392, both < 600; 600 ≤ 784 usable
    const { top, maxHeight } = positionContextMenu({ ...base, x: 100, y: 400, height: 600 })
    expect(top).toBe(VH - 600 - 8)
    expect(top + 600).toBeLessThanOrEqual(VH)
    expect(maxHeight).toBeUndefined()
  })

  it('pins + scrolls a menu taller than the viewport so the last action stays reachable', () => {
    const { top, maxHeight } = positionContextMenu({ ...base, x: 100, y: 600, height: 1200 })
    expect(top).toBe(8)
    expect(maxHeight).toBe(VH - 16)
    expect(top + (maxHeight ?? 0)).toBeLessThanOrEqual(VH)
  })

  it('survives a viewport smaller than the padding', () => {
    const { left, top, maxHeight } = positionContextMenu({
      x: 20,
      y: 20,
      width: 200,
      height: 300,
      viewportWidth: 12,
      viewportHeight: 10,
    })
    expect(left).toBe(0)
    expect(top).toBe(0)
    expect(maxHeight).toBe(10)
  })

  it('honours a custom pad', () => {
    // roomBelow = 800 - 40 - 500 = 260 < 300 → flip up to 500 - 300
    expect(positionContextMenu({ ...base, x: 100, y: 500, pad: 40 })).toEqual({
      left: 100,
      top: 200,
    })
  })
})
