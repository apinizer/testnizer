/**
 * Issue #276 follow-up — a .zip picked with the Postman card's file button:
 * main reads it and answers with a one-time handle (`archive`) instead of
 * text; the modal shows the archive summary and imports through the same
 * handle path as a picked v3 folder. A zip main refuses shows its reason.
 *
 * Fail-before: the modal called `openFile()` with no card, ignored a failed
 * result silently and treated every pick as text content.
 */
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import ImportModal from '../../src/renderer/components/modals/ImportModal'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import { useEnvironmentStore } from '../../src/renderer/stores/environment.store'

const ARCHIVE = {
  handle: 'z-1',
  folderName: 'postman-export.zip',
  source: 'zip',
  kind: 'workspace',
  collections: ['Shop API', 'Status'],
  requestCount: 7,
  environmentCount: 2,
  globalsCount: 0,
}

let api: {
  importExport: Record<string, ReturnType<typeof vi.fn>>
  folder: Record<string, ReturnType<typeof vi.fn>>
}

function setup(openResult: unknown): void {
  api = {
    importExport: {
      openFile: vi.fn(async () => openResult),
      importPostman: vi.fn(),
      pickPostmanFolder: vi.fn(),
      importPostmanFolder: vi.fn(async () => ({
        success: true,
        data: { success: true, endpointCount: 7 },
      })),
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

describe('issue #276 follow-up — a .zip through the Postman file button', () => {
  it('the card is passed to main; the archive summary shows; import uses the handle', async () => {
    setup({
      success: true,
      data: { filePath: '/x/postman-export.zip', content: '', archive: ARCHIVE },
    })
    expect(screen.getByText(/or a \.zip: a Postman data export/)).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: /Click to select a/i }))
    expect(api.importExport.openFile).toHaveBeenCalledWith({ format: 'postman' })
    const summary = await screen.findByTestId('import-postman-folder-summary')
    expect(summary).toHaveTextContent('Ready to import archive: postman-export.zip')
    expect(summary).toHaveTextContent('2 collection(s) · 7 request(s) · 2 environment(s)')
    expect(screen.getByPlaceholderText('Folder name')).toHaveValue('postman-export')
    fireEvent.click(screen.getByRole('button', { name: /^Import$/ }))
    await waitFor(() => expect(api.importExport.importPostmanFolder).toHaveBeenCalled())
    expect(api.importExport.importPostmanFolder.mock.calls[0][0]).toEqual({
      projectId: 'proj-1',
      handle: 'z-1',
      folderId: 'new-folder',
    })
    expect(api.importExport.importPostman).not.toHaveBeenCalled()
  })

  it('a zip main refuses shows the reason and stays on the source step', async () => {
    setup({
      success: false,
      error:
        'The .zip archive was refused: the entry "../evil.json" climbs out of the archive with "..".',
    })
    fireEvent.click(await screen.findByRole('button', { name: /Click to select a/i }))
    expect(await screen.findByText(/climbs out of the archive/)).toBeInTheDocument()
    expect(screen.queryByTestId('import-postman-folder-summary')).toBeNull()
    expect(screen.getByRole('button', { name: /Click to select a/i })).toBeInTheDocument()
  })
})
