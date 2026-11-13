/**
 * Tester finding 7 — with 6–8 long-named projects open at ~1280 px the
 * header's project tabs pushed Save / Pull / Push / Branch / user menu off
 * screen: every tab was `shrink-0` and nothing scrolled.
 *
 * jsdom has no layout, so this pins the layout CONTRACT; the e2e spec
 * `tests/e2e/ui/67-project-tab-close-dirty.spec.ts` measures it at 1280 px.
 *  - the right-hand actions never shrink;
 *  - the tab strip is the only flexible child (`min-w-0 flex-1`) and scrolls
 *    sideways like the request tab strip (`.scroll-strip`, issue #241);
 *  - each tab shrinks to a minimum width, truncates its label and keeps the
 *    full name as its tooltip;
 *  - × is a real, labelled button (it was a hover-only `<span>`).
 */
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'

const permissive: unknown = new Proxy(
  {},
  { get: () => new Proxy({}, { get: () => async () => ({ success: true, data: [] }) }) },
)
;(globalThis as unknown as { window: { api: unknown } }).window.api = permissive

import Header from '../../src/renderer/components/layout/Header'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import type { Project } from '../../src/renderer/types'

const names = Array.from(
  { length: 7 },
  (_, i) => `Customer Onboarding Platform Integration ${i + 1}`,
)
const projects = names.map((n, i) => ({
  id: `p${i}`,
  name: `slug-${i}`,
  display_name: n,
  save_mode: 'git',
})) as unknown as Project[]

beforeEach(() => {
  useWorkspaceStore.setState({
    projects,
    activeProjectId: 'p0',
    openProjectIds: projects.map((p) => p.id),
  })
})
afterEach(() => cleanup())

describe('header layout with many open projects', () => {
  it('only the tab strip flexes; the actions group never shrinks', () => {
    render(<Header />)
    const actions = screen.getByTestId('header-actions')
    expect(actions.className).toMatch(/\bshrink-0\b/)
    expect(within(actions).getByTestId('header-save')).toBeTruthy()
    expect(within(actions).getByTestId('user-menu-trigger')).toBeTruthy()

    const strip = screen.getByTestId('header-project-tabs')
    for (const cls of ['scroll-strip', 'min-w-0', 'flex-1']) expect(strip.classList).toContain(cls)
    // The strip comes before the actions, and nothing else in the header flexes.
    const header = strip.closest('header')!
    const flexing = [...header.children].filter((c) => c.classList.contains('flex-1'))
    expect(flexing).toEqual([strip])
  })

  it('tabs shrink to a minimum, truncate, and keep the full name as tooltip', () => {
    render(<Header />)
    const tabs = screen.getAllByTestId('header-project-tab')
    expect(tabs).toHaveLength(7)
    tabs.forEach((tab, i) => {
      expect(tab.classList).not.toContain('shrink-0')
      expect(tab.classList).toContain('shrink')
      expect(tab.classList).toContain('min-w-[96px]')
      expect(tab.classList).toContain('max-w-[200px]')
      expect(tab.getAttribute('title')).toBe(names[i])
      expect(within(tab).getByText(names[i]).classList).toContain('truncate')
      const close = within(tab).getByRole('button', { name: new RegExp(names[i]) })
      expect(close.getAttribute('data-testid')).toBe(`header-project-tab-close-p${i}`)
    })
  })
})
