/**
 * Modals that used to report success they had not achieved.
 *
 *   APP-5  `SettingsModal` fired its persist as `.catch(() => {})` and closed
 *          unconditionally. A rejected write closed exactly like a successful
 *          one — bad for any setting, unacceptable for `sslVerification`, where
 *          a user turning certificate checking off (or back ON) got no sign
 *          their choice never landed.
 *   APP-6  the same modal, on the read side: unreadable settings rendered as
 *          DEFAULTS, so pressing Save wrote defaults over the real config.
 *   APP-7  `FolderSettingsModal` fell back to `{type:'inherit'}` when the stored
 *          auth JSON would not parse, then Save persisted that fallback —
 *          destroying a folder's authentication permanently.
 *
 * These are asserted at the surface the user sees: does the modal stay open,
 * does it say what failed, and is Save prevented from doing damage.
 */
import * as React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

const toastSuccess = vi.fn()
const toastError = vi.fn()
const toastWarning = vi.fn()
vi.mock('../../src/renderer/lib/toast', () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
    info: vi.fn(),
    warning: (...a: unknown[]) => toastWarning(...a),
  },
}))

import SettingsModal from '../../src/renderer/components/modals/SettingsModal'
import FolderSettingsModal from '../../src/renderer/components/modals/FolderSettingsModal'
import ProjectDetailModal from '../../src/renderer/components/modals/ProjectDetailModal'
import NewProjectModal from '../../src/renderer/components/modals/NewProjectModal'
import EndpointSaveModal from '../../src/renderer/components/modals/EndpointSaveModal'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import { useBranchStore } from '../../src/renderer/stores/branch.store'

const setAll = vi.fn()
const getAll = vi.fn()

/** Bridge stub that leaves jsdom's `window` intact (async queries need it). */
function installBridge(over: Record<string, unknown> = {}): void {
  ;(window as unknown as { api: Record<string, unknown> }).api = {
    settings: { setAll, getAll, get: vi.fn(), set: vi.fn() },
    folder: { list: vi.fn(async () => ({ success: true, data: [] })) },
    ...over,
  }
}

beforeEach(() => {
  setAll.mockReset()
  getAll.mockReset()
  toastSuccess.mockReset()
  toastError.mockReset()
  getAll.mockResolvedValue({ success: true, data: {} })
  installBridge()
  useUIStore.setState({ showSettingsModal: true })
})
afterEach(cleanup)

/* ── APP-5: a refused write keeps the dialog open ──────────────────────────── */

describe('Settings: a failed save is not reported as success (APP-5)', () => {
  it('keeps the modal open, shows the reason, and never claims "saved"', async () => {
    setAll.mockResolvedValue({ success: false, error: 'EACCES: settings.json is read-only' })

    render(<SettingsModal />)
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }))

    await waitFor(() => expect(screen.getByText(/read-only/)).toBeInTheDocument())
    // The modal is still on screen — the user can retry or copy values out.
    // (`show` is what gates the whole render: `if (!show) return null`.)
    expect(useUIStore.getState().showSettingsModal).toBe(true)
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
    expect(toastSuccess).not.toHaveBeenCalled()
  })

  it('treats a rejected promise the same as a `success:false` envelope', async () => {
    setAll.mockRejectedValue(new Error('bridge went away'))

    render(<SettingsModal />)
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }))

    await waitFor(() => expect(screen.getByText(/bridge went away/)).toBeInTheDocument())
    expect(useUIStore.getState().showSettingsModal).toBe(true)
    expect(toastSuccess).not.toHaveBeenCalled()
  })

  it('closes and confirms only when the write actually landed', async () => {
    setAll.mockResolvedValue({ success: true })

    render(<SettingsModal />)
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }))

    await waitFor(() => expect(useUIStore.getState().showSettingsModal).toBe(false))
    expect(toastSuccess).toHaveBeenCalled()
  })

  it('sends the security-relevant setting it was asked to send', async () => {
    setAll.mockResolvedValue({ success: true })

    render(<SettingsModal />)
    const ssl = await screen.findByLabelText(/SSL/i)
    fireEvent.click(ssl) // turn certificate verification OFF

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(setAll).toHaveBeenCalled())
    expect(setAll.mock.calls[0][0]).toMatchObject({ sslVerification: false })
  })
})

/* ── PG-1 class: a numeric field the user cannot empty ─────────────────────── */

describe('Settings: numeric fields can be cleared while typing (PG-1 class)', () => {
  it('never writes 0 px into the app-wide font size', async () => {
    setAll.mockResolvedValue({ success: true })
    render(<SettingsModal />)

    const font = (await screen.findByLabelText(/font size/i)) as HTMLInputElement
    const original = font.value
    expect(original).not.toBe('')
    fireEvent.change(font, { target: { value: '' } })
    // The box is empty on screen — that is the point — but nothing invalid has
    // been propagated. `Number('')` is 0 and finite, so the old code wrote a
    // 0 px font size and Save made every label in the app invisible.
    expect(font.value).toBe('')

    fireEvent.blur(font)
    // Blur falls back to the last good value, not to `min`.
    expect(font.value).toBe(original)

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(setAll).toHaveBeenCalled())
  })

  it('lets a timeout be retyped without the old digits sticking', async () => {
    setAll.mockResolvedValue({ success: true })
    render(<SettingsModal />)

    const timeout = (await screen.findByLabelText(/timeout/i)) as HTMLInputElement
    fireEvent.change(timeout, { target: { value: '' } })
    fireEvent.change(timeout, { target: { value: '5000' } })
    // Clamping on every keystroke turned "1" + "3" into 13; the draft does not.
    expect(timeout.value).toBe('5000')

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(setAll).toHaveBeenCalled())
    expect(setAll.mock.calls[0][0]).toMatchObject({ defaultTimeout: 5000 })
  })
})

/* ── APP-6: unreadable settings are not shown as defaults ──────────────────── */

describe('Settings: an unreadable config is not disguised as defaults (APP-6)', () => {
  it('says the values could not be read', async () => {
    getAll.mockResolvedValue({ success: false, error: 'unexpected token' })

    render(<SettingsModal />)

    // The bug: the form silently showed defaults, and Save wrote them over the
    // real configuration.
    await waitFor(() =>
      expect(screen.getByText(/Saved settings could not be read/)).toBeInTheDocument(),
    )
  })
})

/* ── APP-7: refusing to overwrite what could not be read ───────────────────── */

describe('Folder settings: unreadable auth blocks Save (APP-7)', () => {
  const props = {
    folderId: 'f1',
    folderName: 'Orders',
    open: true,
    onClose: () => {},
  }

  it('reports the parse failure and disables Save', async () => {
    const loadRow = vi.fn(async () => ({
      id: 'f1',
      // A hand-edited file, or a row written by a newer schema.
      auth: '{"type":"bearer",,}',
      pre_script: null,
      post_script: null,
    }))

    render(<FolderSettingsModal {...props} loadRow={loadRow} />)

    await waitFor(() =>
      expect(screen.getByText(/saved authentication could not be read/i)).toBeInTheDocument(),
    )
    // The stored value is still on disk; Save must not be able to replace it
    // with the 'inherit' the form fell back to.
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('leaves Save enabled when the stored auth parses', async () => {
    const loadRow = vi.fn(async () => ({
      id: 'f1',
      auth: '{"type":"bearer","token":"t"}',
      pre_script: null,
      post_script: null,
    }))

    render(<FolderSettingsModal {...props} loadRow={loadRow} />)

    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled())
    expect(screen.queryByText(/could not be read/i)).not.toBeInTheDocument()
  })
})

/* ── APP-4: "Project settings saved" must mean it was ──────────────────────── */

describe('Project details: the success toast follows the writes (APP-4)', () => {
  const PROJECT = {
    id: 'p1',
    workspace_id: 'w1',
    name: 'orders-api',
    display_name: 'Orders API',
    type: 'http' as const,
    save_mode: 'local' as const,
    sort_order: 0,
    created_at: 1,
    updated_at: 1,
  }

  function seed(setImpl: (key: string, value: unknown) => unknown) {
    installBridge({
      settings: { setAll, getAll, get: vi.fn(async () => ({ success: true, data: null })), set: vi.fn(setImpl) },
    })
    useWorkspaceStore.setState({
      projects: [PROJECT],
      activeProjectId: 'p1',
      updateProject: vi.fn(async () => true),
      renameProject: vi.fn(async () => true),
    } as never)
    useUIStore.setState({ showSettingsModal: false, showProjectDetailModal: true })
  }

  it('reports a refused write instead of claiming the save succeeded', async () => {
    // The realistic failure: `settings:set` RESOLVES `{success:false}`. It never
    // rejects, so the try/catch that used to guard this caught nothing and the
    // success toast fired over a write that did not land.
    seed(async () => ({ success: false, error: 'EROFS: read-only file system' }))

    render(<ProjectDetailModal />)
    fireEvent.click(await screen.findByRole('button', { name: /Save Changes/i }))

    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(String(toastError.mock.calls[0][0])).toContain('EROFS')
    expect(toastSuccess).not.toHaveBeenCalled()
  })

  it('saves the Description the user typed', async () => {
    // Reported 30 July: the box accepted text, Save reported "saved", and the
    // value was gone on reopen. It was rendered and edited but never put into
    // the update payload — and the store's type omitted the field, so nothing
    // failed to compile. The handler and the repo had always accepted it.
    const updateProject = vi.fn(async () => true)
    seed(async () => ({ success: true, data: true }))
    useWorkspaceStore.setState({ updateProject } as never)

    render(<ProjectDetailModal />)
    const area = (await screen.findAllByRole('textbox')).find((b) => b.tagName === 'TEXTAREA')
    if (!area) throw new Error('no Description textarea')
    fireEvent.change(area, { target: { value: 'rc2-test' } })

    fireEvent.click(screen.getByRole('button', { name: /Save Changes/i }))

    await waitFor(() => expect(updateProject).toHaveBeenCalled())
    expect(updateProject.mock.calls[0][1]).toMatchObject({ description: 'rc2-test' })
  })

  it('confirms only when every write landed', async () => {
    seed(async () => ({ success: true, data: true }))

    render(<ProjectDetailModal />)
    fireEvent.click(await screen.findByRole('button', { name: /Save Changes/i }))

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled())
    expect(toastError).not.toHaveBeenCalled()
  })

  it('reports a refused project update, which the store used to swallow whole', async () => {
    // `updateProject` returned `Promise<void>` and absorbed the failure, so the
    // re-fetch quietly restored the old values while the toast said "saved".
    seed(async () => ({ success: true, data: true }))
    useWorkspaceStore.setState({ updateProject: vi.fn(async () => false) } as never)

    render(<ProjectDetailModal />)
    fireEvent.click(await screen.findByRole('button', { name: /Save Changes/i }))

    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(toastSuccess).not.toHaveBeenCalled()
  })
})

/* ── APP-2: a step that never ran is not part of a clean run ───────────────── */

describe('New project: a failed import is reported, not hidden (APP-2)', () => {
  const importLocal = vi.fn()
  const selectFile = vi.fn()

  function seedWizard() {
    ;(window as unknown as { api: Record<string, unknown> }).api = {
      save: { selectFile, importLocal },
      settings: { set: vi.fn(async () => ({ success: true, data: true })), get: vi.fn() },
      git: { pull: vi.fn(), push: vi.fn() },
      folder: { list: vi.fn(async () => ({ success: true, data: [] })) },
    }
    useWorkspaceStore.setState({
      projects: [],
      activeProjectId: null,
      activeWorkspaceId: 'w1',
      createProject: vi.fn(async () => 'p-new'),
      setActiveProject: vi.fn(),
    } as never)
    useBranchStore.setState({ ensureDefault: vi.fn(async () => {}), createBranch: vi.fn() } as never)
    useUIStore.setState({ showNewProjectModal: true })
  }

  beforeEach(() => {
    importLocal.mockReset()
    selectFile.mockReset()
    toastWarning.mockReset()
    selectFile.mockResolvedValue({
      success: true,
      data: { filePath: '/tmp/collection.json', project: { project: { name: 'Orders API' } } },
    })
    seedWizard()
  })

  /** Drives the wizard from the source picker to the Create button. */
  async function reachCreateStep() {
    fireEvent.click(await screen.findByText('Open Local'))
    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    // Step 2 arrives once the picker resolved and prefilled the name.
    await waitFor(() => expect(selectFile).toHaveBeenCalled())
    fireEvent.click(await screen.findByRole('button', { name: /Next/ }))
    return screen.findByRole('button', { name: /Create/ })
  }

  it('warns when the import bridge reports failure', async () => {
    // The realistic shape: resolves `{success:false}` rather than throwing, so
    // the old try/catch never fired and the success screen showed regardless.
    importLocal.mockResolvedValue({ success: false, error: 'Unsupported collection format' })

    render(<NewProjectModal />)
    fireEvent.click(await reachCreateStep())

    await waitFor(() => expect(importLocal).toHaveBeenCalled())
    // Partial success: the project exists, so this is a warning rather than a
    // failed flow — but it must be SAID.
    await waitFor(() => expect(toastWarning).toHaveBeenCalled())
    expect(String(toastWarning.mock.calls[0][0])).toContain('Unsupported collection format')
  })

  it('says nothing when the import actually succeeded', async () => {
    importLocal.mockResolvedValue({ success: true, data: {} })

    render(<NewProjectModal />)
    fireEvent.click(await reachCreateStep())

    await waitFor(() => expect(importLocal).toHaveBeenCalled())
    expect(toastWarning).not.toHaveBeenCalled()
  })
})

/* ── APP-9: "no folders" and "couldn't read them" are different ────────────── */

describe('Save endpoint: an unreadable folder list says so (APP-9)', () => {
  const folderList = vi.fn()

  function seedSave() {
    ;(window as unknown as { api: Record<string, unknown> }).api = {
      folder: { list: folderList, create: vi.fn() },
      savedRequest: { get: vi.fn(async () => ({ success: true, data: {} })) },
      settings: { setAll, getAll, get: vi.fn(), set: vi.fn() },
    }
    useUIStore.setState({ showSettingsModal: false, showEndpointSaveModal: true })
    useWorkspaceStore.setState({ activeProjectId: 'p1', projects: [] } as never)
  }

  beforeEach(() => {
    folderList.mockReset()
    seedSave()
  })

  it('reports a refused folder list instead of showing "no folders"', async () => {
    folderList.mockResolvedValue({ success: false, error: 'SQLITE_CORRUPT' })

    render(<EndpointSaveModal />)

    // The bug: both cases rendered the same empty-state line, so a failed read
    // invited the user to save into a root they never chose.
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/could not be read/i))
    expect(screen.getByRole('alert').textContent).toContain('SQLITE_CORRUPT')
  })

  it('still says "no folders" when the project genuinely has none', async () => {
    folderList.mockResolvedValue({ success: true, data: [] })

    render(<EndpointSaveModal />)

    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })
})
