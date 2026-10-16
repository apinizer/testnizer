/**
 * Issue #208 — the APIs tree project root's Export wrote Testnizer JSON only.
 * It now opens a format submenu (Testnizer JSON · Postman v2.1 · OpenAPI 3 ·
 * Insomnia) that runs the shared `exportProjectAs`; a folder's Export is
 * unchanged (Testnizer folder JSON, no submenu).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'
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

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
}))
vi.mock('../../src/renderer/lib/toast', () => ({ toast: toastMock }))

const apiMock = vi.hoisted(() => {
  const g = globalThis as unknown as { window?: { api?: unknown } }
  const api = {
    importExport: {
      exportPostman: (..._a: unknown[]): Promise<unknown> =>
        Promise.resolve({ success: true, data: '{}', skipped: [] }),
      saveFile: (..._a: unknown[]): Promise<unknown> =>
        Promise.resolve({ success: true, data: '/tmp/out.json' }),
    },
    save: {
      exportProject: (..._a: unknown[]): Promise<unknown> =>
        Promise.resolve({ success: true, data: { path: '/tmp/p.json' } }),
      exportFolder: (..._a: unknown[]): Promise<unknown> =>
        Promise.resolve({ success: true, data: { path: '/tmp/f.json' } }),
    },
    endpoint: { get: () => Promise.resolve({ success: false, data: null }) },
  }
  if (!g.window) g.window = { api }
  else g.window.api = api
  return api
})

import TreeView from '../../src/renderer/components/sidebar/TreeView'
import { setLocale } from '../../src/renderer/lib/i18n'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import type { TreeNode } from '../../src/renderer/types'

const tree: TreeNode[] = [
  {
    id: 'project-proj-1',
    label: 'My API',
    type: 'module',
    children: [{ id: 'f1', label: 'Payments', type: 'folder', icon: 'folder', children: [] }],
  },
]

let exportPostman: ReturnType<typeof vi.fn>
let saveFile: ReturnType<typeof vi.fn>
let exportProject: ReturnType<typeof vi.fn>
let exportFolder: ReturnType<typeof vi.fn>

beforeEach(() => {
  setLocale('en')
  for (const fn of Object.values(toastMock)) fn.mockReset()
  exportPostman = vi.fn(async () => ({ success: true, data: '{"item":[]}', skipped: [] }))
  saveFile = vi.fn(async (_c: string, name: string) => ({ success: true, data: `/tmp/${name}` }))
  exportProject = vi.fn(async () => ({ success: true, data: { path: '/tmp/p.json' } }))
  exportFolder = vi.fn(async () => ({ success: true, data: { path: '/tmp/f.json' } }))
  apiMock.importExport.exportPostman = exportPostman
  apiMock.importExport.saveFile = saveFile
  apiMock.save.exportProject = exportProject
  apiMock.save.exportFolder = exportFolder
  ;(HTMLElement.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {}
  useTabsStore.setState({ tabs: [], activeTabId: null })
  useWorkspaceStore.setState({
    treeData: tree,
    openNodeIds: new Set(['project-proj-1']),
    searchQuery: '',
    activeProjectId: 'proj-1',
    activeNodeId: null,
    refreshTree: async () => {},
  })
})

afterEach(cleanup)

function rightClick(label: string): void {
  const row = screen.getByText(label).closest('[data-testid="tree-node"]')
  expect(row).not.toBeNull()
  fireEvent.contextMenu(row as Element, { clientX: 20, clientY: 20 })
}

describe('APIs tree root Export picks a format (issue #208)', () => {
  it('offers the four formats and exports the project as Postman v2.1', async () => {
    render(<TreeView />)
    rightClick('My API')
    fireEvent.click(screen.getByRole('button', { name: 'Export' }))

    const menus = document.querySelectorAll<HTMLElement>('[data-context-menu]')
    expect(menus.length).toBe(2)
    const submenu = menus[1]
    expect(
      within(submenu)
        .getAllByRole('button')
        .map((b) => b.textContent?.trim()),
    ).toEqual(['Testnizer JSON', 'Postman v2.1', 'OpenAPI 3', 'Insomnia'])

    fireEvent.click(within(submenu).getByRole('button', { name: 'Postman v2.1' }))
    await waitFor(() => expect(saveFile).toHaveBeenCalledTimes(1))
    expect(exportPostman).toHaveBeenCalledWith('proj-1')
    expect(saveFile).toHaveBeenCalledWith('{"item":[]}', 'My API.postman_collection.json')
    expect(exportProject).not.toHaveBeenCalled()
  })

  it('Testnizer JSON from the submenu still uses the native project export', async () => {
    render(<TreeView />)
    rightClick('My API')
    fireEvent.click(screen.getByRole('button', { name: 'Export' }))
    fireEvent.click(screen.getByRole('button', { name: 'Testnizer JSON' }))
    await waitFor(() => expect(exportProject).toHaveBeenCalledWith('proj-1'))
    expect(exportPostman).not.toHaveBeenCalled()
  })

  it('a folder Export has no submenu and exports the folder', async () => {
    render(<TreeView />)
    rightClick('Payments')
    fireEvent.click(screen.getByRole('button', { name: 'Export' }))
    await waitFor(() => expect(exportFolder).toHaveBeenCalledWith('f1'))
    expect(document.querySelectorAll('[data-context-menu]').length).toBe(0)
    expect(exportProject).not.toHaveBeenCalled()
  })
})
