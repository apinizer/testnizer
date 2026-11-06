/**
 * A dialog doing work it cannot cancel stays open until the work ends.
 *
 * Closing NewProjectModal or ImportModal does not stop what they started: the
 * work finishes behind the user's back, then switches project or closes a modal
 * they reopened, and a second Create or Import can run on top of the first.
 * X, Cancel, and Escape are refused while the work is in flight.
 */
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('../../src/renderer/lib/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

import ImportModal from '../../src/renderer/components/modals/ImportModal'
import NewProjectModal from '../../src/renderer/components/modals/NewProjectModal'
import { useBranchStore } from '../../src/renderer/stores/branch.store'
import { useEnvironmentStore } from '../../src/renderer/stores/environment.store'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'

const WAIT = { timeout: 10_000 }

function held<T>() {
  let resolve: (v: T) => void = () => {}
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve: (v: T) => resolve(v) }
}

const pressEscape = () =>
  fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })

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
  useUIStore.setState({
    showImportModal: false,
    importModalInitialFormatId: null,
    showNewProjectModal: false,
  })
})

describe('ImportModal while an import is running', () => {
  const ARCHIVE = {
    handle: 'z-1',
    folderName: 'export.zip',
    source: 'zip',
    kind: 'workspace',
    collections: ['Shop'],
    requestCount: 7,
    environmentCount: 0,
    globalsCount: 0,
  }

  async function startImport(reply: Promise<unknown>) {
    const importPostmanFolder = vi.fn(() => reply)
    ;(window as unknown as { api: unknown }).api = {
      importExport: {
        openFile: vi.fn(async () => ({
          success: true,
          data: { filePath: '/x/export.zip', content: '', archive: ARCHIVE },
        })),
        importPostmanFolder,
      },
      folder: {
        create: vi.fn(async () => ({ success: true, data: { id: 'new-folder' } })),
        delete: vi.fn(async () => ({ success: true })),
      },
    }
    useWorkspaceStore.setState({
      activeProjectId: 'proj-1',
      treeData: [],
      refreshTree: vi.fn().mockResolvedValue(undefined),
    })
    useEnvironmentStore.setState({
      fetchEnvironments: vi.fn().mockResolvedValue(undefined),
      fetchGlobalVariables: vi.fn().mockResolvedValue(undefined),
    } as never)
    useUIStore.setState({ showImportModal: true, importModalInitialFormatId: 'postman' })
    render(<ImportModal />)
    fireEvent.click(await screen.findByRole('button', { name: /Click to select a/i }))
    await screen.findByTestId('import-postman-folder-summary')
    fireEvent.click(screen.getByRole('button', { name: /^Import$/ }))
    await waitFor(() => expect(importPostmanFolder).toHaveBeenCalled())
    return importPostmanFolder
  }

  it('refuses X, Cancel and Escape, and closes itself when the import ends', async () => {
    const reply = held<unknown>()
    await startImport(reply.promise)

    const close = screen.getByRole('button', { name: 'Close dialog' })
    const cancel = screen.getByRole('button', { name: 'Cancel' })
    expect(close).toBeDisabled()
    expect(cancel).toBeDisabled()
    fireEvent.click(close)
    fireEvent.click(cancel)
    pressEscape()
    expect(useUIStore.getState().showImportModal).toBe(true)
    expect(screen.getByTestId('import-modal')).toBeInTheDocument()

    await act(async () => {
      reply.resolve({ success: true, data: { success: true, endpointCount: 7 } })
    })
    await waitFor(() => expect(useUIStore.getState().showImportModal).toBe(false))
  })

  it('a failed import leaves the dialog usable and closable', async () => {
    const reply = held<unknown>()
    await startImport(reply.promise)
    await act(async () => {
      reply.resolve({ success: false, error: 'refused by the importer' })
    })
    await screen.findByText('refused by the importer')
    const close = screen.getByRole('button', { name: 'Close dialog' })
    expect(close).not.toBeDisabled()
    fireEvent.click(close)
    expect(useUIStore.getState().showImportModal).toBe(false)
  })
})

describe('NewProjectModal while work is running', () => {
  function seed(createProject: () => Promise<string>, api: Record<string, unknown> = {}) {
    const setActiveProject = vi.fn()
    ;(window as unknown as { api: unknown }).api = {
      save: { selectFile: vi.fn(), selectDirectory: vi.fn() },
      settings: { set: vi.fn(async () => ({ success: true, data: true })), get: vi.fn() },
      git: { pull: vi.fn(), push: vi.fn() },
      folder: { list: vi.fn(async () => ({ success: true, data: [] })) },
      ...api,
    }
    useWorkspaceStore.setState({
      projects: [],
      activeProjectId: null,
      activeWorkspaceId: 'w1',
      createProject,
      setActiveProject,
    } as never)
    useBranchStore.setState({
      ensureDefault: vi.fn(async () => {}),
      createBranch: vi.fn(),
    } as never)
    useUIStore.setState({ showNewProjectModal: true })
    return { setActiveProject }
  }

  /** Create New → name → storage → Create. */
  async function pressCreate() {
    fireEvent.click(await screen.findByTestId('new-project-next'))
    const inputs = await screen.findAllByRole('textbox', {}, WAIT)
    fireEvent.change(inputs[0], { target: { value: 'Orders API' } })
    fireEvent.click(screen.getByTestId('new-project-next'))
    fireEvent.click(await screen.findByTestId('new-project-create', {}, WAIT))
  }

  it('refuses X and Escape during Create', async () => {
    const created = held<string>()
    const createProject = vi.fn(() => created.promise)
    seed(createProject)
    render(<NewProjectModal />)
    await pressCreate()
    await waitFor(() => expect(createProject).toHaveBeenCalled(), WAIT)

    const close = screen.getByTestId('new-project-close')
    expect(close).toBeDisabled()
    fireEvent.click(close)
    pressEscape()
    expect(useUIStore.getState().showNewProjectModal).toBe(true)

    await act(async () => {
      created.resolve('p-new')
    })
    // Ends the done screen's timer, which would otherwise outlive this test.
    fireEvent.click(await screen.findByTestId('new-project-done', {}, WAIT))
  })

  it('refuses X and Escape during a clone', async () => {
    const list = held<unknown>()
    const gitListFiles = vi.fn(() => list.promise)
    seed(
      vi.fn(async () => 'p-new'),
      {
        save: {
          gitListFiles,
          gitCleanup: vi.fn(),
          selectDirectory: vi.fn(async () => ({ success: true, data: '/tmp/clone' })),
        },
      },
    )
    render(<NewProjectModal />)
    fireEvent.click(await screen.findByText('Clone from Git', {}, WAIT))
    fireEvent.change(await screen.findByPlaceholderText(/github\.com/i, {}, WAIT), {
      target: { value: 'https://example.com/r.git' },
    })
    fireEvent.click(await screen.findByTestId('new-project-clone-browse', {}, WAIT))
    await waitFor(() =>
      expect(screen.getByTestId('new-project-clone-dir')).toHaveValue('/tmp/clone'),
    )
    fireEvent.click(screen.getByTestId('new-project-next'))
    await waitFor(() => expect(gitListFiles).toHaveBeenCalled(), WAIT)

    fireEvent.click(screen.getByTestId('new-project-close'))
    pressEscape()
    expect(useUIStore.getState().showNewProjectModal).toBe(true)

    await act(async () => {
      list.resolve({ success: false, error: 'no route to host' })
    })
    await screen.findByText(/no route to host/, {}, WAIT)
    expect(screen.getByTestId('new-project-close')).not.toBeDisabled()
  })

  it('Done switches to the new project at once; a modal reopened after it stays open', async () => {
    const { setActiveProject } = seed(vi.fn(async () => 'p-new'))
    render(<NewProjectModal />)
    await pressCreate()
    fireEvent.click(await screen.findByTestId('new-project-done', {}, WAIT))

    expect(useUIStore.getState().showNewProjectModal).toBe(false)
    expect(setActiveProject).toHaveBeenCalledTimes(1)
    expect(setActiveProject).toHaveBeenCalledWith('p-new')

    await act(async () => {
      useUIStore.setState({ showNewProjectModal: true })
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1300))
    })
    expect(useUIStore.getState().showNewProjectModal).toBe(true)
    expect(setActiveProject).toHaveBeenCalledTimes(1)
  })

  it('with no click, the done screen still moves on to the new project by itself', async () => {
    const { setActiveProject } = seed(vi.fn(async () => 'p-new'))
    render(<NewProjectModal />)
    await pressCreate()
    await screen.findByTestId('new-project-done', {}, WAIT)
    await waitFor(() => expect(setActiveProject).toHaveBeenCalledWith('p-new'), WAIT)
    expect(useUIStore.getState().showNewProjectModal).toBe(false)
  })
})
