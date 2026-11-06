/**
 * Save As preselects the project's first folder. The check read `selectedFolder` from the
 * closure of the open effect, which still held the value from before that effect's reset:
 * every second open saw "a folder is selected", preselected nothing and saved to the project
 * root, so two requests saved in a row landed in different places.
 */
import * as React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'

vi.mock('../../src/renderer/lib/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

import EndpointSaveModal from '../../src/renderer/components/modals/EndpointSaveModal'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import type { Tab } from '../../src/renderer/types'

const folders = [
  { id: 'f1', name: 'First', parent_id: null },
  { id: 'f2', name: 'Second', parent_id: null },
]

const row = (name: string): HTMLElement =>
  screen
    .getAllByTestId('save-folder-row')
    .find((el) => el.getAttribute('data-folder-name') === name) as HTMLElement

async function open(): Promise<void> {
  act(() => useUIStore.setState({ showEndpointSaveModal: true }))
  await waitFor(() => expect(screen.getAllByTestId('save-folder-row').length).toBeGreaterThan(0))
}

function close(): void {
  act(() => useUIStore.setState({ showEndpointSaveModal: false }))
}

beforeEach(() => {
  ;(window as unknown as { api: Record<string, unknown> }).api = {
    folder: {
      list: vi.fn(async () => ({ success: true, data: folders })),
      create: vi.fn(async () => ({
        success: true,
        data: { id: 'f3', name: 'Third', parent_id: null },
      })),
    },
    savedRequest: { get: vi.fn(async () => ({ success: true, data: {} })) },
  }
  useTabsStore.setState({
    tabs: [{ id: 'tab-1', method: 'GET', url: '', protocol: 'http', name: 'x' } as Tab],
    activeTabId: 'tab-1',
  })
  useWorkspaceStore.setState({ activeProjectId: 'p1', projects: [] } as never)
  useUIStore.setState({ showEndpointSaveModal: false })
})

afterEach(cleanup)

describe('Save As preselects the first folder, every time', () => {
  it('on each open in a row', async () => {
    render(React.createElement(EndpointSaveModal))
    for (let i = 0; i < 4; i++) {
      await open()
      await waitFor(() => expect(row('First')).toHaveAttribute('data-selected', 'true'))
      close()
    }
  })

  it('a folder picked last time does not carry over', async () => {
    render(React.createElement(EndpointSaveModal))
    await open()
    await waitFor(() => expect(row('First')).toHaveAttribute('data-selected', 'true'))
    fireEvent.click(row('Second'))
    expect(row('Second')).toHaveAttribute('data-selected', 'true')
    close()
    await open()
    await waitFor(() => expect(row('First')).toHaveAttribute('data-selected', 'true'))
    expect(row('Second')).toHaveAttribute('data-selected', 'false')
  })

  it('a folder just created stays selected', async () => {
    render(React.createElement(EndpointSaveModal))
    await open()
    await waitFor(() => expect(row('First')).toHaveAttribute('data-selected', 'true'))
    close()
    await open()
    ;(window.api as unknown as { folder: { list: ReturnType<typeof vi.fn> } }).folder.list = vi.fn(
      async () => ({
        success: true,
        data: [...folders, { id: 'f3', name: 'Third', parent_id: null }],
      }),
    )
    fireEvent.click(screen.getByText(/New Folder|Create Folder|Yeni Klasör/i))
    fireEvent.change(screen.getByPlaceholderText(/Folder name/i), { target: { value: 'Third' } })
    fireEvent.keyDown(screen.getByPlaceholderText(/Folder name/i), { key: 'Enter' })
    await waitFor(() => expect(row('Third')).toHaveAttribute('data-selected', 'true'))
  })
})
