/**
 * Tester finding 5b — icon-only row buttons in the sidebar trees had no
 * tooltip and no accessible name: the APIs tree "···", the Tests suite "···",
 * and (title only, no aria-label) the Tests folder "···", folder settings
 * (whose title was a hard-coded English string) and remove-from-suite.
 *
 * Rule (testnizer-ui-ux §4): an icon-only button carries `title` AND
 * `aria-label`, both translated. Mocks rows (`RowIconButton`) already did.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import React from 'react'

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
      listEndpoints: () =>
        ok({
          folders: [
            { id: 'sf-1', suite_id: 'suite-1', parent_id: null, name: 'Setup', sort_order: 0 },
          ],
          items: [
            {
              id: 'it-1',
              suite_id: 'suite-1',
              folder_id: null,
              name: 'List orders',
              protocol: 'http',
              method: 'GET',
              url: 'https://api.example.com/orders',
              sort_order: 0,
            },
          ],
        }),
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
import { useUIStore } from '../../src/renderer/stores/ui.store'
import { setLocale } from '../../src/renderer/lib/i18n'
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

const useLocale = (l: 'en' | 'tr'): void => {
  useUIStore.setState({ locale: l })
  setLocale(l)
}

function expectNamed(el: Element, name: string): void {
  expect(el.getAttribute('aria-label')).toBe(name)
  expect(el.getAttribute('title')).toBe(name)
}

beforeEach(() => {
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
  cleanup()
  useLocale('en')
})

describe('APIs tree row "···"', () => {
  it('is named "More actions" / "Diğer işlemler"', () => {
    render(<TreeView />)
    const row = screen.getByText('Payments').closest('[data-testid="tree-node"]') as Element
    fireEvent.mouseEnter(row)
    expectNamed(screen.getByTestId('tree-node-more'), 'More actions')

    cleanup()
    useLocale('tr')
    render(<TreeView />)
    const trRow = screen.getByText('Payments').closest('[data-testid="tree-node"]') as Element
    fireEvent.mouseEnter(trRow)
    expectNamed(screen.getByTestId('tree-node-more'), 'Diğer işlemler')
  })
})

describe('Tests tree row buttons', () => {
  async function renderExpanded(): Promise<void> {
    render(<TestsPanel />)
    fireEvent.click(await screen.findByText('Regression'))
    await waitFor(() => expect(screen.getByTestId('suite-folder-row')).toBeTruthy())
  }

  it('suite "···" is named "More actions"', async () => {
    await renderExpanded()
    fireEvent.mouseEnter(screen.getByTestId('suite-row'))
    expectNamed(screen.getByTestId('suite-row-more'), 'More actions')
  })

  it('folder "···" and folder settings carry translated names', async () => {
    await renderExpanded()
    expectNamed(screen.getByTestId('suite-folder-more'), 'Folder actions')
    expectNamed(screen.getByTestId('suite-folder-settings'), 'Folder Settings')
  })

  it('remove-from-suite is named', async () => {
    await renderExpanded()
    fireEvent.mouseEnter(screen.getByTestId('suite-item-row'))
    expectNamed(screen.getByTestId('suite-item-remove'), 'Remove from suite')
  })

  it('reads Turkish', async () => {
    useLocale('tr')
    await renderExpanded()
    fireEvent.mouseEnter(screen.getByTestId('suite-row'))
    expectNamed(screen.getByTestId('suite-row-more'), 'Diğer işlemler')
    expectNamed(screen.getByTestId('suite-folder-settings'), 'Klasör Ayarları')
  })
})
