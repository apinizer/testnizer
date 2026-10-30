/**
 * Issue #254 — the two Settings dialogs link to each other, and a switch never
 * silently throws away an unsaved draft.
 *
 * CONTRACT (testids; the visual-scope contract is in settings-scope-254.test.tsx):
 *
 *   `settings-open-project-settings`  App dialog button "Open Project settings".
 *        Rendered only while a project is active (`workspace.activeProjectId`
 *        resolves to a project). Opens the Project dialog.
 *   `settings-open-app-settings`     Project dialog button "Open App settings".
 *        Always rendered. (The themes-tab link `project-appearance-link` goes
 *        through the same path — see the scope test.)
 *   Switching = the origin dialog closes (`showSettingsModal` /
 *   `showProjectDetailModal` flip), the target opens.
 *
 *   Dirty guard: when the ORIGIN dialog has unsaved edits (its draft differs
 *   from what it loaded: project dialog = any ProjectSettings / name /
 *   description / storage field; app dialog = any draft field incl. theme,
 *   language, font), clicking the link does NOT switch. It shows
 *     `settings-switch-unsaved-dialog` with three buttons
 *       `settings-switch-unsaved-save`     save the draft, then switch
 *       `settings-switch-unsaved-discard`  drop the draft, then switch
 *       `settings-switch-unsaved-cancel`   close the prompt, stay (draft kept)
 *   A clean dialog switches immediately, no prompt. Discard really discards:
 *   nothing is written, and reopening the dialog shows the stored values.
 *   Save failure keeps the user where they are (no switch).
 *
 * The flags are asserted, not portal visibility (Radix animates/portals).
 */
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('../../src/renderer/lib/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

import ProjectDetailModal from '../../src/renderer/components/modals/ProjectDetailModal'
import SettingsModal from '../../src/renderer/components/modals/SettingsModal'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import { t as translate } from '../../src/renderer/lib/i18n'

const PID = 'p-254x'
const PKEY = `project.${PID}.settings`
const PROJECT = {
  id: PID,
  workspace_id: 'w1',
  name: 'orders-api',
  display_name: 'Orders API',
  type: 'http' as const,
  save_mode: 'local' as const,
  sort_order: 0,
  created_at: 1,
  updated_at: 1,
}
const ok = (data: unknown) => ({ success: true, data })

function setup(opts: { activeProject?: boolean; failProjectSave?: boolean } = {}) {
  const app = { defaultTimeout: 45000, sslVerification: true, followRedirects: true }
  const set = vi.fn(async (key: string) =>
    opts.failProjectSave && key === PKEY ? { success: false, error: 'disk full' } : ok(true),
  )
  const setAll = vi.fn(async () => ok(app))
  ;(window as unknown as { api: Record<string, unknown> }).api = {
    settings: {
      get: vi.fn(async (key: string) => {
        if (key === PKEY) return ok({})
        if (key in app) return ok((app as Record<string, unknown>)[key])
        return ok(undefined)
      }),
      getAll: vi.fn(async () => ok(app)),
      set,
      setAll,
    },
    certificate: { list: vi.fn(async () => ok([])) },
    folder: { list: vi.fn(async () => ok([])) },
  }
  const active = opts.activeProject !== false
  useWorkspaceStore.setState({
    projects: active ? [PROJECT] : [],
    activeProjectId: active ? PID : null,
    updateProject: vi.fn(async () => true),
    renameProject: vi.fn(async () => true),
  } as never)
  return { set, setAll }
}

function mount(show: 'project' | 'app') {
  useUIStore.setState({
    showProjectDetailModal: show === 'project',
    showSettingsModal: show === 'app',
  })
  render(
    React.createElement(
      React.Fragment,
      null,
      React.createElement(ProjectDetailModal),
      React.createElement(SettingsModal),
    ),
  )
}

const flags = () => ({
  project: useUIStore.getState().showProjectDetailModal,
  app: useUIStore.getState().showSettingsModal,
})

async function dirtyProject(): Promise<HTMLInputElement> {
  fireEvent.click(await screen.findByTestId('project-detail-tab-general'))
  const input = (await screen.findByTestId('project-timeout-input')) as HTMLInputElement
  fireEvent.change(input, { target: { value: '1234' } })
  return input
}

function dirtyApp(): HTMLInputElement {
  const input = screen.getByLabelText(translate('settings.timeout')) as HTMLInputElement
  fireEvent.change(input, { target: { value: '1500' } })
  return input
}

beforeEach(() => {
  const ui = useUIStore.getState()
  ui.setLocale('en')
  ui.setTheme('light')
  useUIStore.setState({ showProjectDetailModal: false, showSettingsModal: false })
})
afterEach(cleanup)

describe('cross-links — clean dialogs switch immediately', () => {
  it('App dialog -> Project settings (only offered while a project is active)', async () => {
    setup()
    mount('app')
    fireEvent.click(await screen.findByTestId('settings-open-project-settings'))
    await waitFor(() => expect(flags()).toEqual({ project: true, app: false }))
    expect(screen.queryByTestId('settings-switch-unsaved-dialog')).toBeNull()
  })

  it('App dialog without an active project has no "Open Project settings"', async () => {
    setup({ activeProject: false })
    mount('app')
    await screen.findByTestId('app-settings-title')
    expect(screen.queryByTestId('settings-open-project-settings')).toBeNull()
  })

  it('Project dialog -> App settings', async () => {
    setup()
    mount('project')
    fireEvent.click(await screen.findByTestId('settings-open-app-settings'))
    await waitFor(() => expect(flags()).toEqual({ project: false, app: true }))
    expect(screen.queryByTestId('settings-switch-unsaved-dialog')).toBeNull()
  })
})

describe('cross-links — the project dialog guards its unsaved draft', () => {
  it('prompts instead of switching; Cancel keeps the dialog and the typed value', async () => {
    const { set } = setup()
    mount('project')
    const input = await dirtyProject()
    fireEvent.click(screen.getByTestId('settings-open-app-settings'))

    expect(await screen.findByTestId('settings-switch-unsaved-dialog')).toBeTruthy()
    expect(flags()).toEqual({ project: true, app: false })

    fireEvent.click(screen.getByTestId('settings-switch-unsaved-cancel'))
    await waitFor(() => expect(screen.queryByTestId('settings-switch-unsaved-dialog')).toBeNull())
    expect(flags()).toEqual({ project: true, app: false })
    expect(input.value).toBe('1234')
    expect(set.mock.calls.filter((c) => c[0] === PKEY)).toHaveLength(0)
  })

  it('Discard switches and writes nothing; reopening shows the stored (empty) value', async () => {
    const { set } = setup()
    mount('project')
    await dirtyProject()
    fireEvent.click(screen.getByTestId('settings-open-app-settings'))
    fireEvent.click(await screen.findByTestId('settings-switch-unsaved-discard'))

    await waitFor(() => expect(flags()).toEqual({ project: false, app: true }))
    expect(set.mock.calls.filter((c) => c[0] === PKEY)).toHaveLength(0)

    // back to the project dialog: the discarded draft is gone
    useUIStore.setState({ showSettingsModal: false, showProjectDetailModal: true })
    fireEvent.click(await screen.findByTestId('project-detail-tab-general'))
    const again = (await screen.findByTestId('project-timeout-input')) as HTMLInputElement
    expect(again.value).toBe('')
  })

  it('Save writes the draft, then switches', async () => {
    const { set } = setup()
    mount('project')
    await dirtyProject()
    fireEvent.click(screen.getByTestId('settings-open-app-settings'))
    fireEvent.click(await screen.findByTestId('settings-switch-unsaved-save'))

    await waitFor(() => expect(flags()).toEqual({ project: false, app: true }))
    const call = set.mock.calls.find((c) => c[0] === PKEY)
    expect(call).toBeTruthy()
    expect((call![1] as Record<string, unknown>).requestTimeout).toBe(1234)
  })

  it('a failed Save keeps the user in the project dialog (no silent switch)', async () => {
    setup({ failProjectSave: true })
    mount('project')
    await dirtyProject()
    fireEvent.click(screen.getByTestId('settings-open-app-settings'))
    fireEvent.click(await screen.findByTestId('settings-switch-unsaved-save'))
    await waitFor(() => expect(screen.queryByTestId('settings-switch-unsaved-dialog')).toBeNull())
    expect(flags()).toEqual({ project: true, app: false })
  })

  it('the Appearance link row goes through the same guard', async () => {
    setup()
    mount('project')
    await dirtyProject()
    fireEvent.click(await screen.findByTestId('project-detail-tab-themes'))
    fireEvent.click(await screen.findByTestId('project-appearance-link'))
    expect(await screen.findByTestId('settings-switch-unsaved-dialog')).toBeTruthy()
    expect(flags()).toEqual({ project: true, app: false })
  })

  it('a reset ("Use app setting") counts as an unsaved edit too', async () => {
    const { set } = setup()
    // a project that holds a legacy value
    const api = (window as unknown as { api: { settings: { get: ReturnType<typeof vi.fn> } } }).api
    api.settings.get.mockImplementation(async (key: string) =>
      key === PKEY ? ok({ sslVerification: true }) : ok(undefined),
    )
    mount('project')
    fireEvent.click(await screen.findByTestId('project-detail-tab-general'))
    fireEvent.click(await screen.findByTestId('project-setting-reset-ssl'))
    fireEvent.click(screen.getByTestId('settings-open-app-settings'))
    expect(await screen.findByTestId('settings-switch-unsaved-dialog')).toBeTruthy()
    expect(set.mock.calls.filter((c) => c[0] === PKEY)).toHaveLength(0)
  })
})

describe('cross-links — the app dialog guards its unsaved draft', () => {
  it('prompts instead of switching; Cancel keeps the dialog and the typed value', async () => {
    const { setAll } = setup()
    mount('app')
    await screen.findByTestId('app-settings-title')
    const input = dirtyApp()
    fireEvent.click(screen.getByTestId('settings-open-project-settings'))

    expect(await screen.findByTestId('settings-switch-unsaved-dialog')).toBeTruthy()
    expect(flags()).toEqual({ project: false, app: true })

    fireEvent.click(screen.getByTestId('settings-switch-unsaved-cancel'))
    await waitFor(() => expect(screen.queryByTestId('settings-switch-unsaved-dialog')).toBeNull())
    expect(flags()).toEqual({ project: false, app: true })
    expect(input.value).toBe('1500')
    expect(setAll).not.toHaveBeenCalled()
  })

  it('Discard switches without saving', async () => {
    const { setAll } = setup()
    mount('app')
    await screen.findByTestId('app-settings-title')
    dirtyApp()
    fireEvent.click(screen.getByTestId('settings-open-project-settings'))
    fireEvent.click(await screen.findByTestId('settings-switch-unsaved-discard'))
    await waitFor(() => expect(flags()).toEqual({ project: true, app: false }))
    expect(setAll).not.toHaveBeenCalled()
  })

  it('Save writes the draft through setAll, then switches', async () => {
    const { setAll } = setup()
    mount('app')
    await screen.findByTestId('app-settings-title')
    dirtyApp()
    fireEvent.click(screen.getByTestId('settings-open-project-settings'))
    fireEvent.click(await screen.findByTestId('settings-switch-unsaved-save'))
    await waitFor(() => expect(flags()).toEqual({ project: true, app: false }))
    expect(setAll).toHaveBeenCalledTimes(1)
    expect((setAll.mock.calls[0] as unknown[])[0]).toMatchObject({ defaultTimeout: 1500 })
  })

  it('an unsaved theme / language / font change counts as dirty', async () => {
    setup()
    mount('app')
    await screen.findByTestId('app-settings-title')
    fireEvent.click(screen.getByRole('button', { name: translate('settings.dark') }))
    fireEvent.click(screen.getByTestId('settings-open-project-settings'))
    expect(await screen.findByTestId('settings-switch-unsaved-dialog')).toBeTruthy()
    expect(flags()).toEqual({ project: false, app: true })
  })
})
