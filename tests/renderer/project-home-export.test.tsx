/**
 * Issue #208 — the Home / Projects card menu had Rename · Duplicate · Delete but
 * no Export, so a snapshot of a project meant opening it and finding Settings.
 *
 * The card now offers Rename → Duplicate → Export → Delete. Export opens the
 * format picker WITHOUT opening the project (the picker is mounted next to
 * ProjectHome in AppShell's no-project branch — rendered for real here, so a
 * missing mount fails this test), and the chosen format reaches its IPC.
 */
import * as React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'

// Stores read `window.api.<ns>` at module-eval time; give them a permissive
// bridge before the import graph runs (same as runner-frame-screens).
vi.hoisted(() => {
  const ns = new Proxy(
    {},
    {
      get: (_t, p) =>
        p === 'then'
          ? undefined
          : (..._a: unknown[]) => Promise.resolve({ success: true, data: null }),
    },
  )
  const api = new Proxy({}, { get: (_t, p) => (p === 'then' ? undefined : ns) })
  const g = globalThis as unknown as { window?: { api?: unknown } }
  if (!g.window) g.window = {}
  g.window.api = api
})

vi.mock('../../src/renderer/components/shared/MonacoWrapper', () => ({
  default: () => <div data-testid="monaco" />,
}))

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
}))
vi.mock('../../src/renderer/lib/toast', () => ({ toast: toastMock }))

import { mockWindowApi } from './screens/_mount'
import AppShell from '../../src/renderer/components/layout/AppShell'
import { setLocale } from '../../src/renderer/lib/i18n'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import { useAuthStore } from '../../src/renderer/stores/auth.store'
import { useProjectExportStore } from '../../src/renderer/stores/project-export.store'
import type { Project } from '../../src/renderer/types'

const PROJECT = {
  id: 'proj-home-208',
  workspace_id: 'ws-1',
  name: 'billing-api',
  display_name: 'Billing API',
  type: 'http',
  created_at: Date.now(),
  updated_at: Date.now(),
} as unknown as Project

let exportPostman: ReturnType<typeof vi.fn>
let exportProject: ReturnType<typeof vi.fn>
let saveFile: ReturnType<typeof vi.fn>
let setActiveProject: ReturnType<typeof vi.fn>

beforeEach(() => {
  setLocale('en')
  for (const fn of Object.values(toastMock)) fn.mockReset()
  if (!('ResizeObserver' in globalThis)) {
    ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }
  HTMLElement.prototype.hasPointerCapture = () => false
  HTMLElement.prototype.scrollIntoView = () => {}

  exportPostman = vi.fn(async () => ({ success: true, data: '{"item":[]}', skipped: [] }))
  exportProject = vi.fn(async () => ({ success: true, data: { path: '/tmp/x.json' } }))
  saveFile = vi.fn(async (_c: string, name: string) => ({ success: true, data: `/tmp/${name}` }))
  mockWindowApi({
    importExport: { exportPostman, saveFile },
    save: { exportProject },
  })

  setActiveProject = vi.fn()
  useAuthStore.setState({
    isAuthenticated: true,
    isGuest: false,
    hasPasswordSet: false,
    isLoading: false,
    checkSession: vi.fn(async () => {}),
  } as unknown as Partial<ReturnType<typeof useAuthStore.getState>>)
  useWorkspaceStore.setState({
    initialized: true,
    initialize: vi.fn(async () => {}),
    activeWorkspaceId: 'ws-1',
    activeProjectId: null,
    projects: [PROJECT],
    fetchProjects: vi.fn(async () => {}),
    setActiveProject,
  } as unknown as Partial<ReturnType<typeof useWorkspaceStore.getState>>)
  useProjectExportStore.setState({ target: null })
})

afterEach(cleanup)

function openCardMenu(): HTMLElement {
  render(<AppShell />)
  expect(screen.getByTestId('project-home')).toBeTruthy()
  const card = screen
    .getByText('Billing API')
    .closest('[data-testid="project-card"]') as HTMLElement
  expect(card).toBeTruthy()
  // The "…" trigger is the card's only icon button without text.
  const trigger = within(card)
    .getAllByRole('button')
    .find((b) => (b.textContent ?? '').trim() === '') as HTMLElement
  fireEvent.click(trigger)
  return card
}

describe('Home card Export (issue #208)', () => {
  it('menu order is Rename → Duplicate → Export → Delete', () => {
    const card = openCardMenu()
    const labels = within(card)
      .getAllByRole('button')
      .map((b) => (b.textContent ?? '').trim())
      .filter((s) => s.length > 0)
    expect(labels).toEqual(['Rename', 'Duplicate', 'Export…', 'Delete'])
  })

  it('exports as Postman without opening the project', async () => {
    openCardMenu()
    fireEvent.click(screen.getByTestId('home-card-export'))

    const picker = await screen.findByTestId('project-export-modal')
    expect(within(picker).getByText('Billing API')).toBeTruthy()
    fireEvent.click(within(picker).getByTestId('project-export-format-postman'))
    fireEvent.click(within(picker).getByTestId('project-export-confirm'))

    await waitFor(() => expect(saveFile).toHaveBeenCalledTimes(1))
    expect(exportPostman).toHaveBeenCalledWith(PROJECT.id)
    expect(saveFile).toHaveBeenCalledWith('{"item":[]}', 'Billing API.postman_collection.json')
    expect(exportProject).not.toHaveBeenCalled()
    // The project was never opened.
    expect(setActiveProject).not.toHaveBeenCalled()
    expect(useWorkspaceStore.getState().activeProjectId).toBeNull()
    await waitFor(() =>
      expect(toastMock.success).toHaveBeenCalledWith(
        'Exported Billing API.postman_collection.json',
        expect.objectContaining({ description: '/tmp/Billing API.postman_collection.json' }),
      ),
    )
    await waitFor(() => expect(screen.queryByTestId('project-export-modal')).toBeNull())
  })

  it('defaults to Testnizer JSON', async () => {
    openCardMenu()
    fireEvent.click(screen.getByTestId('home-card-export'))
    const picker = await screen.findByTestId('project-export-modal')
    expect(
      within(picker).getByTestId('project-export-format-testnizer').getAttribute('aria-checked'),
    ).toBe('true')
    fireEvent.click(within(picker).getByTestId('project-export-confirm'))
    await waitFor(() => expect(exportProject).toHaveBeenCalledWith(PROJECT.id))
    expect(exportPostman).not.toHaveBeenCalled()
  })
})
