/**
 * Issue #276 — the Import modal with every Postman artifact.
 *
 *  - An environment / globals file under the Postman card is announced as an
 *    environment import and creates NO folder (before: the modal created a
 *    folder first, which is why the importer rejected env files).
 *  - An import that returns warnings shows the result step with a collapsible
 *    list instead of closing (before: closed with a toast, warnings unseen).
 *  - A failed import removes the folder the modal created for it.
 *  - A clean import still closes the modal right away.
 */
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import ImportModal from '../../src/renderer/components/modals/ImportModal'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import { useEnvironmentStore } from '../../src/renderer/stores/environment.store'

const ENV_FILE = JSON.stringify({
  name: 'Dev',
  _postman_variable_scope: 'environment',
  values: [{ key: 'h', value: 'x' }],
})
const GLOBALS_FILE = JSON.stringify({
  name: 'Globals',
  _postman_variable_scope: 'globals',
  values: [{ key: 'g', value: '1' }],
})
// No `_postman_id`, no schema — the old renderer guard did not recognise it.
const V2_FILE = JSON.stringify({ info: { name: 'Plain' }, item: [] })
const V1_FILE = JSON.stringify({ id: 'c', name: 'Old', order: [], requests: [] })

interface Api {
  importExport: {
    openFile: ReturnType<typeof vi.fn>
    importPostman: ReturnType<typeof vi.fn>
  }
  folder: { create: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> }
}
let api: Api

function setup(fileContent: string, importResult: unknown): void {
  api = {
    importExport: {
      openFile: vi.fn(async () => ({
        success: true,
        data: { content: fileContent, filePath: '/tmp/file.json' },
      })),
      importPostman: vi.fn(async () => importResult),
    },
    folder: {
      create: vi.fn(async () => ({ success: true, data: { id: 'new-folder' } })),
      delete: vi.fn(async () => ({ success: true })),
    },
  }
  ;(window as unknown as { api: Api }).api = api
  useWorkspaceStore.setState({
    activeProjectId: 'proj-1',
    treeData: [],
    refreshTree: vi.fn().mockResolvedValue(undefined),
  })
  useEnvironmentStore.setState({ fetchEnvironments: vi.fn().mockResolvedValue(undefined) })
  useUIStore.setState({ showImportModal: true, importModalInitialFormatId: 'postman' })
  render(<ImportModal />)
}

async function pickFile(): Promise<void> {
  fireEvent.click(await screen.findByRole('button', { name: /Click to select a Postman file/i }))
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

describe('issue #276 — Import modal and Postman artifacts', () => {
  it('an environment file: note shown, no folder created, imported with folderId null', async () => {
    setup(ENV_FILE, { success: true, data: { success: true, environmentName: 'Dev' } })
    await pickFile()
    expect(await screen.findByTestId('import-env-note')).toHaveTextContent(/environment/i)
    expect(screen.getByPlaceholderText('Folder name')).not.toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: /^Import$/ }))
    await waitFor(() => expect(api.importExport.importPostman).toHaveBeenCalled())
    expect(api.folder.create).not.toHaveBeenCalled()
    expect(api.importExport.importPostman.mock.calls[0][0]).toMatchObject({ folderId: null })
    await waitFor(() => expect(useUIStore.getState().showImportModal).toBe(false))
  })

  it('a globals file is announced as globals', async () => {
    setup(GLOBALS_FILE, { success: true, data: { success: true } })
    await pickFile()
    expect(await screen.findByTestId('import-env-note')).toHaveTextContent(/globals/i)
  })

  it.each([
    ['v2 without _postman_id', V2_FILE],
    ['v1', V1_FILE],
  ])('a %s collection passes the type guard (no mismatch error)', async (_label, file) => {
    setup(file, { success: true, data: { success: true } })
    await pickFile()
    expect(await screen.findByText(/Ready to import/i)).toBeInTheDocument()
    expect(screen.queryByTestId('import-env-note')).toBeNull()
  })

  it('warnings: the result step lists them (collapsible) and Done closes', async () => {
    setup(V2_FILE, {
      success: true,
      data: {
        success: true,
        endpointCount: 3,
        folderCount: 1,
        exampleCount: 2,
        warnings: ['"Get": oauth1 authentication is not supported by Testnizer', 'second'],
      },
    })
    await pickFile()
    fireEvent.click(await screen.findByRole('button', { name: /^Import$/ }))
    const result = await screen.findByTestId('import-result')
    expect(useUIStore.getState().showImportModal).toBe(true)
    expect(screen.getByTestId('import-result-summary')).toHaveTextContent('3')
    expect(screen.queryByTestId('import-warnings-list')).toBeNull()
    fireEvent.click(screen.getByTestId('import-warnings-toggle'))
    expect(screen.getAllByTestId('import-warning').map((li) => li.textContent)).toEqual([
      '"Get": oauth1 authentication is not supported by Testnizer',
      'second',
    ])
    expect(result).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('import-result-done'))
    await waitFor(() => expect(useUIStore.getState().showImportModal).toBe(false))
  })

  it('a failed import removes the folder the modal created for it', async () => {
    setup(V2_FILE, { success: true, data: { success: false, error: 'boom' } })
    await pickFile()
    fireEvent.click(await screen.findByRole('button', { name: /^Import$/ }))
    await waitFor(() => expect(api.folder.delete).toHaveBeenCalledWith('new-folder'))
    expect(api.folder.create).toHaveBeenCalledTimes(1)
    expect(useUIStore.getState().showImportModal).toBe(true)
  })

  it('a clean import (no warnings) closes right away', async () => {
    setup(V2_FILE, { success: true, data: { success: true, endpointCount: 1 } })
    await pickFile()
    fireEvent.click(await screen.findByRole('button', { name: /^Import$/ }))
    await waitFor(() => expect(useUIStore.getState().showImportModal).toBe(false))
    expect(screen.queryByTestId('import-result')).toBeNull()
  })
})
