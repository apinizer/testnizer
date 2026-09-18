/**
 * Issue #122 — the tab strip's method badge must follow the editor's method
 * dropdown immediately, not only after Save (Postman behaviour).
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useRequestStore } from '../../src/renderer/stores/request.store'
import type { Tab } from '../../src/renderer/types'

beforeEach(() => {
  useTabsStore.setState({
    tabs: [
      {
        id: 'tab-a',
        name: 'New Endpoint',
        protocol: 'http',
        endpointId: 'ep-1',
        method: 'GET',
        url: 'https://api.test',
        isDirty: false,
      } as Tab,
      {
        id: 'tab-b',
        name: 'Other',
        protocol: 'http',
        endpointId: 'ep-2',
        method: 'GET',
        url: 'https://api.test/other',
        isDirty: false,
      } as Tab,
    ],
    activeTabId: 'tab-a',
  })
  useRequestStore.setState({ ...useRequestStore.getState(), method: 'GET' })
})

describe('setMethod → tab badge (issue #122)', () => {
  it('updates the active tab method before any Save', () => {
    useRequestStore.getState().setMethod('POST')
    const tabs = useTabsStore.getState().tabs
    expect(tabs.find((t) => t.id === 'tab-a')?.method).toBe('POST')
    expect(tabs.find((t) => t.id === 'tab-a')?.isDirty).toBe(true)
  })

  it('leaves the other tabs untouched', () => {
    useRequestStore.getState().setMethod('DELETE')
    const other = useTabsStore.getState().tabs.find((t) => t.id === 'tab-b')
    expect(other?.method).toBe('GET')
    expect(other?.isDirty).toBeFalsy()
  })

  it('is a no-op on the tab strip when no tab is active', () => {
    useTabsStore.setState({ activeTabId: null })
    expect(() => useRequestStore.getState().setMethod('PUT')).not.toThrow()
    expect(useRequestStore.getState().method).toBe('PUT')
  })
})
