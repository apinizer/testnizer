/**
 * Issue #251 — at a narrow editor width the request sub-tabs were clipped and
 * the Key/Value header labels wrapped onto two lines.
 *
 * CONTRACT:
 *  - RequestEditor `req-tab-strip` stays the `.scroll-strip` scroller (#241)
 *    and additionally has `min-w-0` (so it scrolls instead of widening its
 *    parent); every `req-tab-<key>` button has `shrink-0` + `whitespace-nowrap`
 *    — a tab never squeezes or wraps, the strip scrolls and keeps the active
 *    tab in view (existing behaviour).
 *  - KeyValueTable's header row carries `data-testid="kv-header"`; each header
 *    cell that has text is `whitespace-nowrap` (Key / Value / Description and
 *    their Turkish counterparts stay on one line at 1024 px and 16 px font).
 *
 * Guard tests (green now, must stay green): strip class + the existing tab
 * testids. Red now: `min-w-0`, `shrink-0`, `kv-header`.
 */
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'

vi.mock('../../src/renderer/components/shared/MonacoWrapperImpl', () => ({
  default: () => null,
}))
;(window as unknown as { api: unknown }).api = new Proxy(
  {},
  { get: () => new Proxy({}, { get: () => async () => ({ success: true, data: [] }) }) },
)

import RequestEditor from '../../src/renderer/components/request/RequestEditor'
import KeyValueTable from '../../src/renderer/components/shared/KeyValueTable'
import { useUIStore } from '../../src/renderer/stores/ui.store'

afterEach(() => {
  cleanup()
  useUIStore.getState().setLocale('en')
})

describe('request sub-tab strip', () => {
  it('guard: still the scroll-strip scroller with its tabs', () => {
    render(<RequestEditor />)
    const strip = screen.getByTestId('req-tab-strip')
    expect(strip.classList.contains('scroll-strip')).toBe(true)
    expect(screen.getByTestId('req-tab-params')).toBeInTheDocument()
    expect(screen.getByTestId('req-tab-settings')).toBeInTheDocument()
  })

  it('can shrink below its content (min-w-0) so it scrolls instead of clipping', () => {
    render(<RequestEditor />)
    expect(screen.getByTestId('req-tab-strip').className).toMatch(/\bmin-w-0\b/)
  })

  it('no tab squeezes or wraps', () => {
    render(<RequestEditor />)
    const tabs = screen
      .getByTestId('req-tab-strip')
      .querySelectorAll<HTMLElement>('[data-testid^="req-tab-"]')
    expect(tabs.length).toBe(7)
    for (const t of tabs) {
      expect(t.className, t.getAttribute('data-testid') ?? '').toMatch(/\bshrink-0\b/)
      expect(t.className).toMatch(/\bwhitespace-nowrap\b/)
    }
  })
})

describe('Key/Value header', () => {
  function table(): void {
    render(
      <KeyValueTable
        rows={[{ id: 'r1', key: 'a', value: 'b', description: '', enabled: true }]}
        onUpdate={() => {}}
        onRemove={() => {}}
        onAdd={() => {}}
        resizable
      />,
    )
  }

  for (const locale of ['en', 'tr'] as const) {
    it(`header labels never wrap (${locale})`, () => {
      useUIStore.getState().setLocale(locale)
      table()
      const header = screen.getByTestId('kv-header')
      const textCells = Array.from(header.children).filter(
        (c) => (c.textContent ?? '').trim().length > 0,
      )
      expect(textCells.length).toBeGreaterThanOrEqual(3)
      for (const cell of textCells) {
        expect(cell.className, cell.textContent ?? '').toMatch(/\bwhitespace-nowrap\b/)
      }
    })
  }
})
