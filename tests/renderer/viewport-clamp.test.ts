/**
 * Unit tests for the context-menu viewport clamp (issue #58).
 * The math was extracted from ContextMenuShell into a pure function so a
 * right-click near the bottom/right edge — previously clipped — is provably
 * flipped back into view.
 */
import { describe, it, expect } from 'vitest'
import { clampToViewport } from '../../src/renderer/lib/viewport-clamp'

const VW = 1000
const VH = 800

describe('clampToViewport', () => {
  it('leaves an anchor untouched when the element fits', () => {
    expect(
      clampToViewport({ x: 100, y: 100, width: 160, height: 200, viewportWidth: VW, viewportHeight: VH }),
    ).toEqual({ left: 100, top: 100 })
  })

  it('flips left when the element would overflow the right edge', () => {
    // 950 + 160 = 1110 > 1000 - 8 → left = 1000 - 160 - 8 = 832
    const { left, top } = clampToViewport({
      x: 950,
      y: 100,
      width: 160,
      height: 200,
      viewportWidth: VW,
      viewportHeight: VH,
    })
    expect(left).toBe(832)
    expect(top).toBe(100)
  })

  it('flips up when the element would overflow the bottom edge', () => {
    // 700 + 200 = 900 > 800 - 8 → top = 800 - 200 - 8 = 592
    const { left, top } = clampToViewport({
      x: 100,
      y: 700,
      width: 160,
      height: 200,
      viewportWidth: VW,
      viewportHeight: VH,
    })
    expect(left).toBe(100)
    expect(top).toBe(592)
  })

  it('flips both axes for a bottom-right corner click', () => {
    expect(
      clampToViewport({ x: 990, y: 790, width: 160, height: 200, viewportWidth: VW, viewportHeight: VH }),
    ).toEqual({ left: 832, top: 592 })
  })

  it('floors at pad when the element is larger than the viewport (top-left stays reachable)', () => {
    // width 1200 > viewport 1000 → 1000-1200-8 = -208, floored to pad (8)
    const { left } = clampToViewport({
      x: 500,
      y: 50,
      width: 1200,
      height: 100,
      viewportWidth: VW,
      viewportHeight: VH,
    })
    expect(left).toBe(8)
  })

  it('honours a custom pad', () => {
    // 950 + 160 = 1110 > 1000 - 20 → left = 1000 - 160 - 20 = 820
    expect(
      clampToViewport({
        x: 950,
        y: 100,
        width: 160,
        height: 200,
        viewportWidth: VW,
        viewportHeight: VH,
        pad: 20,
      }).left,
    ).toBe(820)
  })
})
