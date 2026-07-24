/**
 * Context menus must stay inside the window — issues #67 (APIs tree) and #58
 * (Tests panel).
 *
 * Both surfaces used to pin their menu at the raw click point: TreeNode guessed
 * its own height (`items.length * 32`) and only ever clamped downward, and the
 * Tests panel clamped without flipping or capping. A right-click near the
 * bottom edge therefore pushed the lower actions — Delete included — past
 * `window.innerHeight`. Both now go through `positionContextMenu`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import React from 'react'

// jsdom gives the scroll container a 0px rect, so the real virtualizer renders
// no rows. Same pass-through stub the other tree suite uses.
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 30,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        key: index,
        index,
        start: index * 30,
        size: 30,
      })),
  }),
}))

vi.hoisted(() => {
  const ok = <T,>(data: T) => Promise.resolve({ success: true, data })
  const stub = {
    savedRequest: { create: () => ok({ id: 'sr' }) },
    endpoint: { get: () => Promise.resolve({ success: false, data: null }) },
    folder: { create: () => ok({ id: 'fld' }) },
    testSuite: {
      list: () =>
        ok([
          {
            id: 'suite-1',
            project_id: 'proj-1',
            name: 'Regression',
            description: null,
            sort_order: 0,
            created_at: 1,
            updated_at: 1,
          },
        ]),
      listEndpoints: () => ok({ items: [], folders: [] }),
    },
  }
  const g = globalThis as unknown as { window?: { api?: unknown } }
  if (!g.window) g.window = { api: stub }
  else g.window.api = stub
})

import TreeView from '../../src/renderer/components/sidebar/TreeView'
import TestsPanel from '../../src/renderer/components/sidebar/TestsPanel'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import type { TreeNode } from '../../src/renderer/types'

const tree: TreeNode[] = [
  {
    id: 'f1',
    label: 'Payments',
    type: 'folder',
    icon: 'folder',
    children: [
      { id: 'e1', label: 'Charge card', type: 'endpoint', method: 'POST', path: '/charge' },
    ],
  },
]

/**
 * jsdom reports every rect as 0×0 — give just the menu a size. 520px is what a
 * full folder menu measures once separators, submenu rows and a non-default
 * font size are in play, i.e. more than the old `items.length * 32` guess.
 */
const MENU_W = 200
let menuHeight = 520
const realRect = Element.prototype.getBoundingClientRect

/** Assert the menu box is fully inside the viewport. */
function expectInsideViewport(menu: HTMLElement): void {
  const top = parseFloat(menu.style.top)
  const left = parseFloat(menu.style.left)
  const height = menu.style.maxHeight ? parseFloat(menu.style.maxHeight) : menuHeight
  expect(top).toBeGreaterThanOrEqual(0)
  expect(left).toBeGreaterThanOrEqual(0)
  expect(top + height).toBeLessThanOrEqual(window.innerHeight)
  expect(left + MENU_W).toBeLessThanOrEqual(window.innerWidth)
}

beforeEach(() => {
  menuHeight = 520
  Element.prototype.getBoundingClientRect = function (this: Element) {
    if (this.hasAttribute('data-context-menu')) {
      return {
        width: MENU_W,
        height: menuHeight,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        x: 0,
        y: 0,
      } as DOMRect
    }
    return realRect.call(this)
  }
  ;(HTMLElement.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {}
  useTabsStore.setState({ tabs: [], activeTabId: null })
  useWorkspaceStore.setState({
    treeData: tree,
    openNodeIds: new Set(['f1']),
    searchQuery: '',
    activeProjectId: 'proj-1',
    activeNodeId: null,
    refreshTree: async () => {},
  })
})

afterEach(() => {
  Element.prototype.getBoundingClientRect = realRect
  // vitest runs without `globals`, so RTL's auto-cleanup never registers.
  cleanup()
})

describe('APIs tree context menu (issue #67)', () => {
  /** Right-click the folder row at the given point and return the menu node. */
  function openMenuAt(clientX: number, clientY: number): HTMLElement {
    render(<TreeView />)
    const row = screen.getByText('Payments').closest('[data-testid="tree-node"]')
    expect(row).not.toBeNull()
    fireEvent.contextMenu(row as Element, { clientX, clientY })
    const menu = document.querySelector('[data-context-menu]')
    expect(menu).not.toBeNull()
    return menu as HTMLElement
  }

  it('flips a folder menu opened near the bottom-right corner back inside the window', () => {
    const menu = openMenuAt(window.innerWidth - 6, window.innerHeight - 6)
    // The action that used to fall off the bottom.
    expect(screen.getByText('Delete')).toBeTruthy()
    expectInsideViewport(menu)
  })

  it('caps and scrolls a menu taller than the window instead of clipping it', () => {
    menuHeight = window.innerHeight + 200
    const menu = openMenuAt(40, window.innerHeight - 20)

    const top = parseFloat(menu.style.top)
    const maxHeight = parseFloat(menu.style.maxHeight)
    expect(top).toBeGreaterThanOrEqual(0)
    expect(maxHeight).toBeGreaterThan(0)
    expect(top + maxHeight).toBeLessThanOrEqual(window.innerHeight)
    expect(menu.style.overflowY).toBe('auto')
  })
})

describe('Tests panel context menu (issue #58)', () => {
  /** Right-click the suite row at the given point and return the menu node. */
  async function openSuiteMenuAt(clientX: number, clientY: number): Promise<HTMLElement> {
    render(<TestsPanel />)
    const row = await screen.findByTestId('suite-row')
    fireEvent.contextMenu(row, { clientX, clientY })
    const menu = document.querySelector('[data-context-menu]')
    expect(menu).not.toBeNull()
    return menu as HTMLElement
  }

  it('flips a suite menu opened near the bottom-right corner back inside the window', async () => {
    expectInsideViewport(await openSuiteMenuAt(window.innerWidth - 6, window.innerHeight - 6))
  })

  it('caps and scrolls a suite menu taller than the window', async () => {
    // The clamp-only predecessor floored `top` at the pad and left the tail of
    // an over-tall menu hanging past the bottom edge with no way to scroll.
    menuHeight = window.innerHeight + 200
    const menu = await openSuiteMenuAt(20, window.innerHeight - 6)
    expectInsideViewport(menu)
    expect(menu.style.overflowY).toBe('auto')
  })
})
