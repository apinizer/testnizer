/**
 * 1.6.0 screen review — the Key/Value header at a narrow editor read
 * "DescriptionBulk Edit": the Description label and the Bulk Edit toggle sat in
 * one `justify-between` cell with no gap inside the 80 px minimum Description
 * track, so they glued together and the toggle ran past the cell.
 *
 * jsdom has no layout, so this asserts the structure that produces it:
 *  - the cell spans the Description track AND the empty 28 px action track
 *    (one more column of room, Bulk Edit right-aligned at the table edge);
 *  - the cell has a gap, may shrink (`min-w-0`) and clips (`overflow-hidden`);
 *  - the label is the part that gives way (`min-w-0 flex-1 truncate` + title);
 *  - the toggle never shrinks or wraps and is pushed right (`ml-auto`);
 *  - EN and TR ("Toplu Düzenle") alike; labels still never wrap (issue #251).
 */
import * as React from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
;(globalThis as unknown as { React: typeof React }).React = React

import KeyValueTable from '../../src/renderer/components/shared/KeyValueTable'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import type { KeyValuePair } from '../../src/renderer/types'

const rows: KeyValuePair[] = [{ id: 'r1', key: 'a', value: '1', enabled: true }]

afterEach(() => {
  cleanup()
  useUIStore.getState().setLocale('en')
})

const classes = (el: Element): string[] => el.className.split(/\s+/)

describe('KeyValueTable header — Description and Bulk Edit do not glue', () => {
  for (const [locale, label] of [
    ['en', 'Bulk Edit'],
    ['tr', 'Toplu Düzenle'],
  ] as const) {
    it(`spacing, alignment and truncation (${locale})`, () => {
      useUIStore.getState().setLocale(locale)
      render(
        <KeyValueTable
          rows={rows}
          onUpdate={vi.fn()}
          onRemove={vi.fn()}
          onAdd={vi.fn()}
          onReplaceAll={vi.fn()}
        />,
      )
      const header = screen.getByTestId('kv-header')
      const toggle = screen.getByTestId('kv-bulk-toggle')
      expect(toggle.textContent).toBe(label)
      const cell = toggle.parentElement as HTMLElement
      expect(cell.parentElement).toBe(header)

      // The cell takes the trailing empty action track too.
      expect(cell.style.gridColumn).toBe('span 2')
      expect(header.lastElementChild).toBe(cell)
      const tracks = header.style.gridTemplateColumns.match(/minmax\([^)]*\)|\d+px|[\d.]+fr/g)
      const spanned = Array.from(header.children).reduce(
        (n, c) => n + ((c as HTMLElement).style.gridColumn === 'span 2' ? 2 : 1),
        0,
      )
      expect(spanned).toBe(tracks?.length)

      // Narrow right padding while spanning: the 80 + 28 px floor leaves room for
      // "Toplu Düzenle" (~88 px) and its focus ring at the table edge.
      expect(classes(cell)).toEqual(expect.arrayContaining(['pl-2.5', 'pr-1']))
      expect(classes(cell)).not.toContain('px-2.5')
      for (const c of ['flex', 'min-w-0', 'gap-2', 'overflow-hidden', 'whitespace-nowrap']) {
        expect(classes(cell), c).toContain(c)
      }
      for (const c of ['ml-auto', 'shrink-0', 'whitespace-nowrap']) {
        expect(classes(toggle), c).toContain(c)
      }
      const name = cell.querySelector('[data-testid="kv-description-label"]') as HTMLElement
      expect(name).toBeTruthy()
      for (const c of ['min-w-0', 'flex-1', 'truncate']) expect(classes(name), c).toContain(c)
      expect(name.getAttribute('title')).toBe(name.textContent)
    })
  }

  it('without Bulk Edit the trailing action track keeps its own (empty) cell', () => {
    render(<KeyValueTable rows={rows} onUpdate={vi.fn()} onRemove={vi.fn()} onAdd={vi.fn()} />)
    const header = screen.getByTestId('kv-header')
    const name = screen.getByTestId('kv-description-label')
    const cell = name.parentElement as HTMLElement
    expect(cell.style.gridColumn).toBe('')
    expect(header.lastElementChild).not.toBe(cell)
  })
})
