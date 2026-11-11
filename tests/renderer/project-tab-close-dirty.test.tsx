/**
 * Tester finding 1 (P0, data loss) — closing a project's header tab threw
 * away its unsaved requests without asking.
 *
 * Repro: edit a request in project A, do not save, switch to project B from
 * the header, press × on A's header tab, reopen A — the edits are gone.
 * `closeProjectTab` deleted A's stashed tab set (`tabsByProject`) outright.
 *
 * Rule now (same as a request tab, issues #9 / #259 / #269): a dirty tab never
 * closes silently. The store refuses to close a project tab that holds dirty
 * tabs unless told to discard; the header asks with the request tab's
 * Save / Discard / Cancel dialog, and Save writes every dirty tab through the
 * one in-place save path before the project closes.
 */
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const saveMock = vi.hoisted(() => ({
  calls: [] as Array<string | null>,
  result: (_tabId: string | null): Record<string, unknown> => ({ success: true }),
}))

vi.mock('../../src/renderer/lib/save-active-request', async (orig) => {
  const real = await orig<typeof import('../../src/renderer/lib/save-active-request')>()
  return {
    ...real,
    saveActiveRequestInPlace: vi.fn(async () => {
      const { useTabsStore: tabs } = await import('../../src/renderer/stores/tabs.store')
      const id = tabs.getState().activeTabId
      saveMock.calls.push(id)
      const res = saveMock.result(id)
      if (res.success && id) tabs.getState().markDirty(id, false)
      return res
    }),
  }
})
vi.mock('../../src/renderer/components/shared/MonacoWrapperImpl', () => ({
  default: () => null,
}))

const permissive: unknown = new Proxy(
  {},
  { get: () => new Proxy({}, { get: () => async () => ({ success: true, data: [] }) }) },
)
;(globalThis as unknown as { window: { api: unknown } }).window.api = permissive

import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import { useEnvironmentStore } from '../../src/renderer/stores/environment.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useRequestStore } from '../../src/renderer/stores/request.store'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import { activateTabStores } from '../../src/renderer/lib/activate-tab'
import HeaderProjectTabs from '../../src/renderer/components/layout/HeaderProjectTabs'
import { deleteProjectReleasingTabs } from '../../src/renderer/lib/close-project-tab'
import type { Project, Tab } from '../../src/renderer/types'

const projects = [
  { id: 'A', name: 'alpha', display_name: 'Alpha' },
  { id: 'B', name: 'beta', display_name: 'Beta' },
] as unknown as Project[]

const s = () => useWorkspaceStore.getState()

function tab(id: string, extra: Partial<Tab> = {}): Omit<Tab, 'isDirty' | 'isLoading'> {
  return { id, name: id, protocol: 'http', method: 'GET', url: '', ...extra } as Omit<
    Tab,
    'isDirty' | 'isLoading'
  >
}

/** Open A with one bound dirty tab (+ one clean tab), then switch to B. */
async function dirtyAThenB(): Promise<void> {
  await s().setActiveProject('A')
  useTabsStore.getState().openTab(tab('a-clean', { endpointId: 'e1' }))
  useTabsStore.getState().openTab(tab('a-dirty', { endpointId: 'e2', name: 'Create order' }))
  useTabsStore.getState().markDirty('a-dirty', true)
  // What the Workbench's active-tab effect does: the edit lives in the
  // request store's per-tab cache, keyed by tab id.
  activateTabStores('a-clean')
  activateTabStores('a-dirty')
  useRequestStore.getState().setUrl('https://example.test/orders?edited=1')
  await s().setActiveProject('B')
  useTabsStore.getState().openTab(tab('b1', { endpointId: 'e9' }))
  activateTabStores('b1')
}

beforeEach(() => {
  saveMock.calls = []
  saveMock.result = () => ({ success: true })
  useTabsStore.setState({ tabs: [], activeTabId: null })
  useEnvironmentStore.setState({ setCurrentProject: async () => {} } as never)
  useUIStore.setState({ showEndpointSaveModal: false } as never)
  useWorkspaceStore.setState({
    projects,
    activeWorkspaceId: 'ws',
    activeProjectId: null,
    openProjectIds: [],
    treeData: [],
    openNodeIds: new Set(),
    searchQuery: '',
    activeNodeId: null,
  })
  // A clean slate: a previous case's closed project leaves no stash behind.
  for (const id of ['A', 'B']) s().closeProjectTab(id, { discardUnsaved: true })
  useWorkspaceStore.setState({ openProjectIds: [], activeProjectId: null })
})

afterEach(() => cleanup())

describe('store guard: a project tab with unsaved requests is not closed silently', () => {
  it('refuses to close a HIDDEN project that holds a dirty tab', async () => {
    await dirtyAThenB()
    const closed = s().closeProjectTab('A')
    expect(closed).toBe(false)
    expect(s().openProjectIds).toContain('A')
    await s().setActiveProject('A')
    const t = useTabsStore.getState().tabs.find((x) => x.id === 'a-dirty')
    expect(t?.isDirty).toBe(true)
  })

  it('refuses to close the ACTIVE project that holds a dirty tab', async () => {
    await s().setActiveProject('A')
    useTabsStore.getState().openTab(tab('a-dirty', { endpointId: 'e2' }))
    useTabsStore.getState().markDirty('a-dirty', true)
    expect(s().closeProjectTab('A')).toBe(false)
    expect(s().activeProjectId).toBe('A')
    expect(useTabsStore.getState().tabs.map((x) => x.id)).toContain('a-dirty')
  })

  it('closes a clean project as before', async () => {
    await s().setActiveProject('A')
    useTabsStore.getState().openTab(tab('a-clean', { endpointId: 'e1' }))
    await s().setActiveProject('B')
    expect(s().closeProjectTab('A')).toBe(true)
    expect(s().openProjectIds).not.toContain('A')
  })
})

describe('header: × on a project with unsaved requests asks first', () => {
  it('shows the unsaved-changes dialog; Cancel keeps the project and its edits', async () => {
    await dirtyAThenB()
    render(<HeaderProjectTabs />)
    fireEvent.click(screen.getByTestId('header-project-tab-close-A'))
    const dialog = await screen.findByTestId('unsaved-changes-dialog')
    expect(dialog.textContent).toContain('Alpha')
    expect(dialog.textContent).toContain('Create order')
    fireEvent.click(screen.getByTestId('unsaved-cancel-btn'))
    expect(screen.queryByTestId('unsaved-changes-dialog')).toBeNull()
    expect(s().openProjectIds).toContain('A')
    expect(s().activeProjectId).toBe('B')
  })

  it('Discard closes the project and releases its tabs’ editor state', async () => {
    await dirtyAThenB()
    // The dirty tab's edits live in the request store's per-tab cache.
    expect(useRequestStore.getState()._tabStates.has('a-dirty')).toBe(true)
    render(<HeaderProjectTabs />)
    fireEvent.click(screen.getByTestId('header-project-tab-close-A'))
    fireEvent.click(await screen.findByTestId('unsaved-discard-btn'))
    await waitFor(() => expect(s().openProjectIds).not.toContain('A'))
    expect(s().activeProjectId).toBe('B')
    expect(useRequestStore.getState()._tabStates.has('a-dirty')).toBe(false)
    expect(useRequestStore.getState()._tabStates.has('a-clean')).toBe(false)
  })

  it('Save writes every dirty tab of the hidden project, then closes it', async () => {
    await dirtyAThenB()
    const urlSeenBySave: string[] = []
    saveMock.result = () => {
      urlSeenBySave.push(useRequestStore.getState().url)
      return { success: true }
    }
    render(<HeaderProjectTabs />)
    fireEvent.click(screen.getByTestId('header-project-tab-close-A'))
    fireEvent.click(await screen.findByTestId('unsaved-save-btn'))
    await waitFor(() => expect(s().openProjectIds).not.toContain('A'))
    // Saved with the dirty tab ACTIVE (the in-place save writes the active tab).
    expect(saveMock.calls).toEqual(['a-dirty'])
    // …and with ITS edits in the editor stores, not B's.
    expect(urlSeenBySave).toEqual(['https://example.test/orders?edited=1'])
    // The user comes back to where they were.
    expect(s().activeProjectId).toBe('B')
    expect(useTabsStore.getState().activeTabId).toBe('b1')
  })

  it('Save stops on a never-saved draft: the project stays open on that tab with Save As', async () => {
    await s().setActiveProject('A')
    useTabsStore.getState().openTab(tab('a-draft', { name: 'Draft' }))
    useTabsStore.getState().markDirty('a-draft', true)
    await s().setActiveProject('B')
    saveMock.result = () => ({ success: false, notApplicable: true })
    render(<HeaderProjectTabs />)
    fireEvent.click(screen.getByTestId('header-project-tab-close-A'))
    fireEvent.click(await screen.findByTestId('unsaved-save-btn'))
    await waitFor(() => expect(useUIStore.getState().showEndpointSaveModal).toBe(true))
    expect(s().openProjectIds).toContain('A')
    expect(s().activeProjectId).toBe('A')
    expect(useTabsStore.getState().activeTabId).toBe('a-draft')
    expect(useTabsStore.getState().tabs.find((x) => x.id === 'a-draft')?.isDirty).toBe(true)
  })

  it('a failed save keeps the dialog open and the project open', async () => {
    await dirtyAThenB()
    saveMock.result = () => ({ success: false, error: 'disk full' })
    render(<HeaderProjectTabs />)
    fireEvent.click(screen.getByTestId('header-project-tab-close-A'))
    fireEvent.click(await screen.findByTestId('unsaved-save-btn'))
    await waitFor(() => expect(saveMock.calls.length).toBe(1))
    expect(screen.getByTestId('unsaved-changes-dialog')).toBeTruthy()
    expect(s().openProjectIds).toContain('A')
  })

  it('a clean project closes on × with no dialog', async () => {
    await s().setActiveProject('A')
    await s().setActiveProject('B')
    render(<HeaderProjectTabs />)
    fireEvent.click(screen.getByTestId('header-project-tab-close-A'))
    expect(screen.queryByTestId('unsaved-changes-dialog')).toBeNull()
    expect(s().openProjectIds).not.toContain('A')
  })
})

describe('sibling path: deleting a project', () => {
  it('releases its stashed tabs’ editor state (rows are gone — nothing to save into)', async () => {
    await dirtyAThenB()
    expect(useRequestStore.getState()._tabStates.has('a-dirty')).toBe(true)
    await deleteProjectReleasingTabs('A')
    expect(s().openProjectIds).not.toContain('A')
    expect(useRequestStore.getState()._tabStates.has('a-dirty')).toBe(false)
    expect(useRequestStore.getState()._tabStates.has('a-clean')).toBe(false)
    // The project the user is in is untouched.
    expect(useRequestStore.getState()._currentTabId).toBe('b1')
  })
})
