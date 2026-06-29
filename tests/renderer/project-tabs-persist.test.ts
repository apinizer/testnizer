/**
 * Relaunch tab-loss fix. Per-project open-tab snapshots (#1) used to live only
 * in an in-memory Map, so on boot it was empty: the first `setActiveProject`
 * restored an empty set via `replaceAllTabs([], …)` and wiped whatever tabs the
 * user had open before quitting. The map is now seeded from localStorage
 * (`testnizer-tabs-by-project`) and re-persisted on every change, so opening a
 * project after a relaunch restores its tabs.
 *
 * Each test re-imports the store graph (`vi.resetModules`) to simulate a fresh
 * app launch — that's the moment the map seeds itself from localStorage.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Tab } from '../../src/renderer/types'

const KEY = 'testnizer-tabs-by-project'

function tab(id: string): Tab {
  return {
    id,
    name: id.toUpperCase(),
    protocol: 'http',
    method: 'GET',
    url: '',
    isDirty: false,
    isLoading: false,
  } as Tab
}

async function freshStores() {
  const { useTabsStore } = await import('../../src/renderer/stores/tabs.store')
  // Importing workspace.store registers the tabs→localStorage subscription and
  // seeds the per-project map from whatever is already on disk.
  const { useWorkspaceStore } = await import('../../src/renderer/stores/workspace.store')
  return { useTabsStore, useWorkspaceStore }
}

describe('per-project tabs survive a relaunch', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
  })

  it('persists the active project tab set to localStorage on change', async () => {
    const { useTabsStore, useWorkspaceStore } = await freshStores()
    useTabsStore.setState({ tabs: [], activeTabId: null })
    useWorkspaceStore.setState({ activeProjectId: 'p1' })

    useTabsStore.getState().openTab(tab('x'))

    const stored = JSON.parse(localStorage.getItem(KEY) || '{}')
    expect(stored.p1?.tabs?.map((t: Tab) => t.id)).toContain('x')
    expect(stored.p1?.activeTabId).toBe('x')
  })

  it('does NOT clobber a stored project set while on Home (no active project)', async () => {
    localStorage.setItem(KEY, JSON.stringify({ p1: { tabs: [tab('keep')], activeTabId: 'keep' } }))
    const { useTabsStore, useWorkspaceStore } = await freshStores()
    useWorkspaceStore.setState({ activeProjectId: null })

    // Going Home drives an empty replaceAllTabs — it must not overwrite p1.
    useTabsStore.getState().replaceAllTabs([], null)

    const stored = JSON.parse(localStorage.getItem(KEY) || '{}')
    expect(stored.p1?.tabs?.map((t: Tab) => t.id)).toEqual(['keep'])
  })

  it('restores a project tab set after a simulated relaunch', async () => {
    // A previous session left tabs for p1 on disk.
    localStorage.setItem(
      KEY,
      JSON.stringify({ p1: { tabs: [tab('restored')], activeTabId: 'restored' } }),
    )
    const { useTabsStore, useWorkspaceStore } = await freshStores()
    useTabsStore.setState({ tabs: [], activeTabId: null })

    // Opening the project must restore its tabs, not wipe them. The synchronous
    // restore (`replaceAllTabs`) runs before the first await; the async tail
    // (env reload + tree build) has no window.api under jsdom and rejects, so
    // swallow it. `setActiveProject` is typed `void` (async impl), hence the
    // `Promise.resolve` wrap to attach `.catch`.
    await Promise.resolve(useWorkspaceStore.getState().setActiveProject('p1')).catch(() => {})

    expect(useTabsStore.getState().tabs.map((t) => t.id)).toEqual(['restored'])
    expect(useTabsStore.getState().activeTabId).toBe('restored')
  })
})
