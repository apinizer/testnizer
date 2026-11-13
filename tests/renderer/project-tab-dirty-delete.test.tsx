/**
 * Follow-up to the project-tab close guard (PR #322).
 *
 *  A) A header project tab shows the request tab strip's dirty dot while any
 *     of its requests is unsaved — for the active project (live tab strip)
 *     and for a hidden one (its stashed `tabsByProject` snapshot). The dot is
 *     driven by the stores, so it must follow edits made AFTER the header
 *     rendered, and go away once the edit is saved or discarded.
 *  B) Deleting a project from Project Home: when it holds unsaved requests,
 *     the delete confirm says how many are lost and lists them by name (the
 *     project-close dialog's list); with none, the confirm is unchanged.
 */
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

vi.mock('../../src/renderer/components/shared/MonacoWrapperImpl', () => ({
  default: () => null,
}))

const permissive: unknown = new Proxy(
  {},
  {
    get: (_t, p) =>
      p === 'then'
        ? undefined
        : new Proxy({}, { get: () => async () => ({ success: true, data: [] }) }),
  },
)
;(globalThis as unknown as { window: { api: unknown } }).window.api = permissive

import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import { useEnvironmentStore } from '../../src/renderer/stores/environment.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import { setLocale } from '../../src/renderer/lib/i18n'
import HeaderProjectTabs from '../../src/renderer/components/layout/HeaderProjectTabs'
import ProjectHome from '../../src/renderer/components/layout/ProjectHome'
import DeleteConfirmDialog from '../../src/renderer/components/modals/DeleteConfirmDialog'
import type { Project, Tab } from '../../src/renderer/types'

const projects = [
  { id: 'A', name: 'alpha', display_name: 'Alpha', type: 'http', created_at: Date.now() },
  { id: 'B', name: 'beta', display_name: 'Beta', type: 'http', created_at: Date.now() },
] as unknown as Project[]

const s = () => useWorkspaceStore.getState()

function tab(id: string, extra: Partial<Tab> = {}): Omit<Tab, 'isDirty' | 'isLoading'> {
  return { id, name: id, protocol: 'http', method: 'GET', url: '', ...extra } as Omit<
    Tab,
    'isDirty' | 'isLoading'
  >
}

const tabOf = (id: string) =>
  screen
    .getAllByTestId('header-project-tab')
    .find((el) => el.getAttribute('data-project-id') === id) as HTMLElement
const dotOf = (id: string) => within(tabOf(id)).queryByTestId('project-tab-dirty')

function useLocale(locale: 'en' | 'tr'): void {
  useUIStore.setState({ locale })
  setLocale(locale)
}

beforeEach(() => {
  useLocale('en')
  HTMLElement.prototype.scrollIntoView = () => {}
  useTabsStore.setState({ tabs: [], activeTabId: null })
  useEnvironmentStore.setState({ setCurrentProject: async () => {} } as never)
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
  for (const id of ['A', 'B']) s().closeProjectTab(id, { discardUnsaved: true })
  useWorkspaceStore.setState({ openProjectIds: [], activeProjectId: null })
})

afterEach(() => cleanup())

describe('A) dirty dot on header project tabs', () => {
  it('follows the ACTIVE project’s edits, stays on it once hidden, and clears on save', async () => {
    await s().setActiveProject('B')
    await s().setActiveProject('A')
    useTabsStore.getState().openTab(tab('a1', { endpointId: 'e1', name: 'Create order' }))
    render(<HeaderProjectTabs />)
    expect(dotOf('A')).toBeNull()
    expect(tabOf('A').getAttribute('data-dirty')).toBe('false')

    // An edit made after the header rendered.
    act(() => useTabsStore.getState().markDirty('a1', true))
    const dot = dotOf('A')
    expect(dot).not.toBeNull()
    expect(dot?.getAttribute('aria-label')).toBe('Unsaved changes')
    expect(tabOf('A').getAttribute('data-dirty')).toBe('true')
    expect(dotOf('B')).toBeNull()
    // The tab's tooltip (and every locator built on it) is still the name.
    expect(tabOf('A').getAttribute('title')).toBe('Alpha')

    // Hidden now: the dot is read from A's stashed snapshot.
    await act(async () => {
      await s().setActiveProject('B')
    })
    expect(s().activeProjectId).toBe('B')
    expect(dotOf('A')).not.toBeNull()
    expect(dotOf('B')).toBeNull()

    // Back on A, saved (the in-place save marks the tab clean): no dot.
    await act(async () => {
      await s().setActiveProject('A')
    })
    expect(dotOf('A')).not.toBeNull()
    act(() => useTabsStore.getState().markDirty('a1', false))
    expect(dotOf('A')).toBeNull()
  })

  it('a hidden dirty project shows the dot; Discard closes it and leaves no dot behind', async () => {
    await s().setActiveProject('A')
    useTabsStore.getState().openTab(tab('a1', { endpointId: 'e1', name: 'Create order' }))
    useTabsStore.getState().markDirty('a1', true)
    await s().setActiveProject('B')
    useTabsStore.getState().openTab(tab('b1', { endpointId: 'e9' }))
    render(<HeaderProjectTabs />)
    expect(dotOf('A')).not.toBeNull()
    expect(dotOf('B')).toBeNull()

    fireEvent.click(screen.getByTestId('header-project-tab-close-A'))
    fireEvent.click(await screen.findByTestId('unsaved-discard-btn'))
    await waitFor(() => expect(s().openProjectIds).not.toContain('A'))
    expect(screen.queryAllByTestId('project-tab-dirty')).toHaveLength(0)

    // Reopened: its tab set was dropped with the discard — clean.
    await act(async () => {
      await s().setActiveProject('A')
    })
    expect(dotOf('A')).toBeNull()
  })

  it('the dot shares the ×’s fixed slot, so the tab width does not depend on it', async () => {
    await s().setActiveProject('A')
    useTabsStore.getState().openTab(tab('a1', { endpointId: 'e1' }))
    useTabsStore.getState().markDirty('a1', true)
    render(<HeaderProjectTabs />)
    const dot = dotOf('A') as HTMLElement
    const slot = dot.parentElement as HTMLElement
    expect(slot.className).toContain('shrink-0')
    expect(dot.className).toContain('absolute')
    expect(within(slot).getByTestId('header-project-tab-close-A')).toBeTruthy()
  })
})

describe('B) deleting a project with unsaved requests', () => {
  async function openDeleteFor(projectName: string): Promise<HTMLElement> {
    render(<ProjectHome />)
    const card = screen
      .getAllByTestId('project-card')
      .find((el) => el.textContent?.includes(projectName)) as HTMLElement
    fireEvent.click(within(card).getByTestId('home-card-menu'))
    fireEvent.click(within(card).getByTestId('home-card-delete'))
    return (await screen.findByTestId('delete-confirm-input')).closest(
      '[role="dialog"]',
    ) as HTMLElement
  }

  it('says how many requests are lost and lists them by name', async () => {
    await s().setActiveProject('A')
    useTabsStore.getState().openTab(tab('a1', { endpointId: 'e1', name: 'Create order' }))
    useTabsStore.getState().openTab(tab('a2', { endpointId: 'e2', name: 'List orders' }))
    useTabsStore.getState().openTab(tab('a3', { endpointId: 'e3', name: 'Clean one' }))
    useTabsStore.getState().markDirty('a1', true)
    useTabsStore.getState().markDirty('a2', true)
    s().goHome()

    const dialog = await openDeleteFor('Alpha')
    const warning = within(dialog).getByTestId('delete-unsaved-warning')
    expect(warning.textContent).toContain('2 unsaved requests will be lost:')
    const names = within(warning).getByTestId('unsaved-names')
    expect(names.textContent).toContain('Create order')
    expect(names.textContent).toContain('List orders')
    expect(names.textContent).not.toContain('Clean one')
  })

  it('one unsaved request: singular wording', async () => {
    await s().setActiveProject('A')
    useTabsStore.getState().openTab(tab('a1', { endpointId: 'e1', name: 'Create order' }))
    useTabsStore.getState().markDirty('a1', true)
    s().goHome()
    const dialog = await openDeleteFor('Alpha')
    expect(within(dialog).getByTestId('delete-unsaved-warning').textContent).toContain(
      '1 unsaved request will be lost:',
    )
  })

  it('a project with no unsaved requests gets the plain confirm', async () => {
    await s().setActiveProject('B')
    useTabsStore.getState().openTab(tab('b1', { endpointId: 'e9', name: 'Ping' }))
    s().goHome()
    const dialog = await openDeleteFor('Beta')
    expect(within(dialog).queryByTestId('delete-unsaved-warning')).toBeNull()
    expect(within(dialog).queryByTestId('unsaved-names')).toBeNull()
    expect(dialog.textContent).toContain(
      'This will permanently delete the project and all its data.',
    )
  })

  it('Turkish wording', () => {
    useLocale('tr')
    render(
      <DeleteConfirmDialog
        open
        itemName="Alpha"
        itemType="project"
        unsavedNames={['Sipariş oluştur', 'Siparişleri listele']}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    )
    expect(screen.getByTestId('delete-unsaved-warning').textContent).toContain(
      'Kaydedilmemiş 2 istek kaybolacak:',
    )
  })

  it('a long list is capped like the project-close dialog’s (+N more)', () => {
    render(
      <DeleteConfirmDialog
        open
        itemName="Alpha"
        itemType="project"
        unsavedNames={['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7']}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    )
    const names = screen.getByTestId('unsaved-names')
    expect(names.querySelectorAll('li')).toHaveLength(6)
    expect(names.textContent).toContain('+2 more')
    expect(names.textContent).not.toContain('r6')
  })
})
