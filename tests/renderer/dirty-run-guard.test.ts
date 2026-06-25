import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── Mocks ────────────────────────────────────────────────────
const saveActiveRequestInPlace = vi.fn(async () => ({ success: true }))
const warn = vi.fn()

let tabsState: { tabs: Array<Record<string, unknown>>; activeTabId: string | null }
vi.mock('../../src/renderer/stores/tabs.store', () => ({
  useTabsStore: { getState: () => tabsState },
}))
vi.mock('../../src/renderer/lib/save-active-request', () => ({
  saveActiveRequestInPlace: () => saveActiveRequestInPlace(),
}))
vi.mock('../../src/renderer/lib/toast', () => ({
  toast: { warning: (m: string) => warn(m), success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

const { saveDirtyRunItemsBeforeRun } = await import('../../src/renderer/lib/dirty-run-guard')

const tab = (over: Record<string, unknown>) => ({
  id: 'tab',
  name: 'Req',
  protocol: 'http',
  isDirty: false,
  isLoading: false,
  ...over,
})

beforeEach(() => {
  saveActiveRequestInPlace.mockClear()
  warn.mockClear()
  // Default: the dirty tab is the ACTIVE one and saving clears its dirty flag.
  saveActiveRequestInPlace.mockImplementation(async () => {
    tabsState.tabs = tabsState.tabs.map((t) => (t.id === tabsState.activeTabId ? { ...t, isDirty: false } : t))
    return { success: true }
  })
})

describe('saveDirtyRunItemsBeforeRun', () => {
  it('auto-saves the active tab when it is a dirty member of the run', async () => {
    tabsState = {
      activeTabId: 'a',
      tabs: [tab({ id: 'a', testSuiteItemId: 'item-1', isDirty: true, name: 'Active item' })],
    }
    const warned = await saveDirtyRunItemsBeforeRun(['item-1'])
    expect(saveActiveRequestInPlace).toHaveBeenCalledTimes(1)
    expect(warned).toEqual([]) // saved → nothing left to warn about
    expect(warn).not.toHaveBeenCalled()
  })

  it('warns about a dirty NON-active tab in the run set (cannot auto-save it)', async () => {
    tabsState = {
      activeTabId: 'a',
      tabs: [
        tab({ id: 'a', endpointId: 'ep-active', isDirty: false }),
        tab({ id: 'b', testSuiteItemId: 'item-2', isDirty: true, name: 'Background item' }),
      ],
    }
    const warned = await saveDirtyRunItemsBeforeRun(['item-2'])
    expect(saveActiveRequestInPlace).not.toHaveBeenCalled()
    expect(warned).toEqual(['Background item'])
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain('Background item')
  })

  it('does nothing when no run item has unsaved edits', async () => {
    tabsState = {
      activeTabId: 'a',
      tabs: [tab({ id: 'a', testSuiteItemId: 'item-1', isDirty: false })],
    }
    const warned = await saveDirtyRunItemsBeforeRun(['item-1'])
    expect(saveActiveRequestInPlace).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
    expect(warned).toEqual([])
  })

  it('ignores dirty tabs that are not part of this run', async () => {
    tabsState = {
      activeTabId: 'a',
      tabs: [tab({ id: 'a', testSuiteItemId: 'other-item', isDirty: true, name: 'Unrelated' })],
    }
    const warned = await saveDirtyRunItemsBeforeRun(['item-1'])
    expect(saveActiveRequestInPlace).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
    expect(warned).toEqual([])
  })
})
