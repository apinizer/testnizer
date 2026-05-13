/**
 * Preview-slot isolation in tabs.store.
 *
 * APIs and Tests are conceptually distinct workspaces, each with its own
 * sidebar tree and its own data tables. A single-click in one tree must
 * not disturb a preview tab from the other — each workspace gets its own
 * preview slot.
 *
 * These tests also cover the dedup path: clicking the same item twice
 * never creates a duplicate tab, regardless of workspace.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'

describe('tabs.store.openPreviewTab — dedup', () => {
  beforeEach(() => {
    useTabsStore.setState({ tabs: [], activeTabId: null })
  })

  it('opens a single tab when the same suite item is clicked twice', () => {
    useTabsStore.getState().openPreviewTab({
      id: 'tab-A',
      name: 'Suite item',
      protocol: 'http',
      testSuiteItemId: 'item-A',
    })
    const firstActive = useTabsStore.getState().activeTabId
    useTabsStore.getState().openPreviewTab({
      id: 'tab-X',
      name: 'Suite item',
      protocol: 'http',
      testSuiteItemId: 'item-A',
    })
    const tabs = useTabsStore.getState().tabs
    expect(tabs).toHaveLength(1)
    expect(useTabsStore.getState().activeTabId).toBe(firstActive)
  })
})

describe('tabs.store.openPreviewTab — per-workspace preview slot', () => {
  beforeEach(() => {
    useTabsStore.setState({ tabs: [], activeTabId: null })
  })

  it('keeps APIs and Tests preview tabs side-by-side instead of overwriting', () => {
    // Suite-item preview opens first.
    useTabsStore.getState().openPreviewTab({
      id: 'tab-suite',
      name: 'Suite item',
      protocol: 'http',
      testSuiteItemId: 'item-A',
    })
    // APIs endpoint single-click follows — must NOT replace the suite slot.
    useTabsStore.getState().openPreviewTab({
      id: 'tab-api',
      name: 'Endpoint',
      protocol: 'http',
      endpointId: 'endpoint-B',
    })

    const tabs = useTabsStore.getState().tabs
    expect(tabs).toHaveLength(2)
    const suitePreview = tabs.find((t) => t.testSuiteItemId === 'item-A')
    const apiPreview = tabs.find((t) => t.endpointId === 'endpoint-B')
    expect(suitePreview).toBeDefined()
    expect(apiPreview).toBeDefined()
    expect(suitePreview!.isPreview).toBe(true)
    expect(apiPreview!.isPreview).toBe(true)
    // The Tests-side preview MUST NOT have an endpointId leaked from the
    // APIs click; the APIs-side preview MUST NOT have a testSuiteItemId.
    expect(suitePreview!.endpointId).toBeUndefined()
    expect(apiPreview!.testSuiteItemId).toBeUndefined()
  })

  it('replaces the suite preview when another suite item is clicked, leaves APIs preview alone', () => {
    useTabsStore.getState().openPreviewTab({
      id: 'tab-api',
      name: 'Endpoint',
      protocol: 'http',
      endpointId: 'endpoint-B',
    })
    useTabsStore.getState().openPreviewTab({
      id: 'tab-suite-1',
      name: 'Suite item 1',
      protocol: 'http',
      testSuiteItemId: 'item-1',
    })
    useTabsStore.getState().openPreviewTab({
      id: 'tab-suite-2',
      name: 'Suite item 2',
      protocol: 'http',
      testSuiteItemId: 'item-2',
    })

    const tabs = useTabsStore.getState().tabs
    expect(tabs).toHaveLength(2)
    // APIs preview untouched
    const apiPreview = tabs.find((t) => t.endpointId === 'endpoint-B')
    expect(apiPreview).toBeDefined()
    // Tests preview replaced in-place with item-2
    const suitePreview = tabs.find((t) => t.testSuiteItemId === 'item-2')
    expect(suitePreview).toBeDefined()
    // And item-1's preview is gone (replaced)
    expect(tabs.find((t) => t.testSuiteItemId === 'item-1')).toBeUndefined()
  })
})
