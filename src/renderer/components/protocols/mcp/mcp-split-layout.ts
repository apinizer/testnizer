/**
 * Resizable splits of the MCP request tab (issue #211): the capability list ↔
 * Explorer (horizontal) and the call header ↔ result (vertical, shared by the
 * Tool / Resource / Prompt panes). Sizes are remembered per user — like the
 * Messages pane height (#172) — through react-resizable-panels' `autoSaveId`
 * with a storage that can never throw (blocked or full localStorage).
 *
 * react-resizable-panels v2 only speaks percentages, while the floors that
 * matter are pixels ("Resources 12" must fit, Invoke must stay visible), so
 * the panes measure their container and convert; with no layout (jsdom, first
 * paint) the fixed fallback percentages apply.
 */
import { useLayoutEffect, useState, type RefObject } from 'react'
import type { PanelGroupStorage } from 'react-resizable-panels'

export const MCP_LIST_SPLIT_ID = 'mcp-list-explorer'
export const MCP_CALL_SPLIT_ID = 'mcp-call-result'

export const LIST_PANEL_ID = 'mcp-capability-list-panel'
export const EXPLORER_PANEL_ID = 'mcp-explorer-panel'
export const CALL_HEADER_PANEL_ID = 'mcp-call-header-panel'
export const CALL_RESULT_PANEL_ID = 'mcp-call-result-panel'

/** Narrowest list that still shows the three tabs with their counts. */
export const LIST_MIN_PX = 220
/** Header floor: title row + the sticky Run row. Result floor: the old `min-h-[5rem]`. */
export const CALL_HEADER_MIN_PX = 96
export const CALL_RESULT_MIN_PX = 80

export const mcpSplitStorage: PanelGroupStorage = {
  getItem(name: string): string | null {
    try {
      return typeof window === 'undefined' ? null : window.localStorage.getItem(name)
    } catch {
      return null
    }
  },
  setItem(name: string, value: string): void {
    try {
      if (typeof window !== 'undefined') window.localStorage.setItem(name, value)
    } catch {
      // A blocked / full store only loses the remembered size.
    }
  },
}

/** `px` of `total` as a percentage, capped; `fallback` when there is no layout yet. */
export function pxToPercent(px: number, total: number, fallback: number, cap: number): number {
  if (!(total > 0)) return fallback
  return Math.min(cap, Math.max(1, Math.round((px / total) * 1000) / 10))
}

/** Two floors that never add up past 100 % on a very short container. */
export function pairedMins(
  aPx: number,
  bPx: number,
  total: number,
  fallback: number,
): [number, number] {
  const a = pxToPercent(aPx, total, fallback, 90)
  const b = pxToPercent(bPx, total, fallback, 90)
  const sum = a + b
  if (sum <= 90) return [a, b]
  const k = 90 / sum
  return [Math.floor(a * k * 10) / 10, Math.floor(b * k * 10) / 10]
}

/** Live width or height of an element (0 without layout / ResizeObserver). */
export function useElementLength(
  ref: RefObject<HTMLElement | null>,
  axis: 'width' | 'height',
): number {
  const [length, setLength] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = (): void => setLength(Math.round(el.getBoundingClientRect()[axis]))
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref, axis])
  return length
}
