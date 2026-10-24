/**
 * Issue #276 part 2 — "Import folder…" under the Postman card: main picks and
 * checks the folder, the modal keeps only the one-time handle, shows what the
 * folder holds and imports it into the chosen destination. A failed import
 * sends the user back to pick the folder again (the handle is spent).
 */
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import ImportModal from '../../src/renderer/components/modals/ImportModal'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import { useEnvironmentStore } from '../../src/renderer/stores/environment.store'

const PICK = {
  handle: 'h-1',
  folderName: 'my-workspace',
  kind: 'workspace',
  collections: ['Shop API', 'Status'],
  requestCount: 12,
  environmentCount: 1,
  globalsCount: 1,
}

let api: {
  importExport: Record<string, ReturnType<typeof vi.fn>>
  folder: Record<string, ReturnType<typeof vi.fn>>
}

function setup(pick: unknown, importResult: unknown): void {
  api = {
    importExport: {
      openFile: vi.fn(),
      importPostman: vi.fn(),
      pickPostmanFolder: vi.fn(async () => pick),
      importPostmanFolder: vi.fn(async () => importResult),
    },
    folder: {
      create: vi.fn(async () => ({ success: true, data: { id: 'new-folder' } })),
      delete: vi.fn(async () => ({ success: true })),
    },
  }
  ;(window as unknown as { api: unknown }).api = api
  useWorkspaceStore.setState({
    activeProjectId: 'proj-1',
    treeData: [],
    refreshTree: vi.fn().mockResolvedValue(undefined),
  })
  useEnvironmentStore.setState({ fetchEnvironments: vi.fn().mockResolvedValue(undefined) })
  useUIStore.setState({ showImportModal: true, importModalInitialFormatId: 'postman' })
  render(<ImportModal />)
}

beforeEach(() => {
  if (!('ResizeObserver' in globalThis)) {
    ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }
})
afterEach(() => {
  cleanup()
  useUIStore.setState({ showImportModal: false, importModalInitialFormatId: null })
})

describe('issue #276 part 2 — Import folder… (Postman v3)', () => {
  it('pick → summary → import into a new folder with the handle', async () => {
    setup(
      { success: true, data: PICK },
      { success: true, data: { success: true, endpointCount: 12 } },
    )
    fireEvent.click(await screen.findByTestId('import-postman-folder'))
    const summary = await screen.findByTestId('import-postman-folder-summary')
    expect(summary).toHaveTextContent('my-workspace')
    expect(summary).toHaveTextContent('2 collection(s) · 12 request(s) · 1 environment(s)')
    expect(summary).toHaveTextContent('globals')
    expect(screen.getByPlaceholderText('Folder name')).toHaveValue('my-workspace')
    fireEvent.click(screen.getByRole('button', { name: /^Import$/ }))
    await waitFor(() => expect(api.importExport.importPostmanFolder).toHaveBeenCalled())
    expect(api.importExport.importPostmanFolder.mock.calls[0][0]).toEqual({
      projectId: 'proj-1',
      handle: 'h-1',
      folderId: 'new-folder',
    })
    expect(api.importExport.importPostman).not.toHaveBeenCalled()
    await waitFor(() => expect(useUIStore.getState().showImportModal).toBe(false))
  })

  it('a folder the main process refuses shows its message and stays on the source step', async () => {
    setup(
      { success: false, error: 'This folder is not a Postman v3 collection or workspace' },
      null,
    )
    fireEvent.click(await screen.findByTestId('import-postman-folder'))
    expect(await screen.findByText(/not a Postman v3 collection or workspace/)).toBeInTheDocument()
    expect(screen.getByTestId('import-postman-folder')).toBeInTheDocument()
  })

  it('a failed import removes the created folder and asks for the folder again', async () => {
    setup({ success: true, data: PICK }, { success: true, data: { success: false, error: 'boom' } })
    fireEvent.click(await screen.findByTestId('import-postman-folder'))
    await screen.findByTestId('import-postman-folder-summary')
    fireEvent.click(screen.getByRole('button', { name: /^Import$/ }))
    await waitFor(() => expect(api.folder.delete).toHaveBeenCalledWith('new-folder'))
    expect(await screen.findByTestId('import-postman-folder')).toBeInTheDocument()
    expect(screen.getByText('boom')).toBeInTheDocument()
  })

  it('a folder with only environments imports without a destination folder', async () => {
    setup(
      { success: true, data: { ...PICK, collections: [], requestCount: 0 } },
      { success: true, data: { success: true } },
    )
    fireEvent.click(await screen.findByTestId('import-postman-folder'))
    expect(await screen.findByTestId('import-env-note')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^Import$/ }))
    await waitFor(() => expect(api.importExport.importPostmanFolder).toHaveBeenCalled())
    expect(api.folder.create).not.toHaveBeenCalled()
    expect(api.importExport.importPostmanFolder.mock.calls[0][0]).toMatchObject({ folderId: null })
  })
})
