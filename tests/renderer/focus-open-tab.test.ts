/**
 * Issue #112, retest — the response survived tab-to-tab switching but was
 * still dropped when the same request was clicked again in the sidebar.
 *
 * The first fix removed the stray `clearResponse()` from the tab strip's
 * switch/close handlers. The tree is a second navigation path into the same
 * tab, and it did something the strip never did: it re-opened the request.
 * `openPreviewTab` recognises an already-open endpoint and ACTIVATES it
 * rather than minting a second tab — so the `clearResponse()` and
 * DB re-hydrate that follow every open landed on a live tab and wiped the
 * response the user had just received.
 *
 * `focusOpenTabFor` is the one gate all of those paths now ask first, which
 * is why it is tested here rather than in each caller: the defect was that
 * the paths disagreed.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useResponseStore } from '../../src/renderer/stores/response.store'
import type { Tab, ApiResponse } from '../../src/renderer/types'

const switchActiveTab = vi.hoisted(() => vi.fn())
vi.mock('../../src/renderer/lib/activate-tab', () => ({
  activateTabStores: vi.fn(),
  switchActiveTab,
}))

const { focusOpenTabFor, openEndpointTab } = await import(
  '../../src/renderer/lib/open-endpoint-tab'
)

function tab(over: Partial<Tab> & { id: string }): Tab {
  return {
    name: 'T',
    protocol: 'http',
    method: 'GET',
    url: '',
    isDirty: false,
    isLoading: false,
    ...over,
  } as Tab
}

function response(status: number): ApiResponse {
  return {
    status,
    statusText: 'OK',
    headers: {},
    body: '{"ok":true}',
    time: 12,
    size: 11,
  } as unknown as ApiResponse
}

beforeEach(() => {
  switchActiveTab.mockClear()
  useTabsStore.setState({ tabs: [], activeTabId: null })
  useResponseStore.setState({ byTab: {}, response: null, isLoading: false })
})

describe('focusOpenTabFor (#112)', () => {
  it('focuses the tab an endpoint already has instead of reopening it', () => {
    useTabsStore.setState({
      tabs: [tab({ id: 'tab-ep-1', endpointId: 'ep-1' })],
      activeTabId: 'tab-ep-1',
    })
    expect(focusOpenTabFor('ep-1')).toBe(true)
    expect(switchActiveTab).toHaveBeenCalledWith('tab-ep-1')
  })

  it('matches a saved request and a suite item by their own id columns', () => {
    useTabsStore.setState({
      tabs: [
        tab({ id: 'tab-sr-1', savedRequestId: 'sr-1' }),
        tab({ id: 'tab-tsi-1', testSuiteItemId: 'tsi-1' }),
      ],
      activeTabId: 'tab-sr-1',
    })
    expect(focusOpenTabFor('sr-1')).toBe(true)
    expect(focusOpenTabFor('tsi-1')).toBe(true)
    expect(switchActiveTab).toHaveBeenLastCalledWith('tab-tsi-1')
  })

  it('matches on the tab id alone, which is how the fallback open path names tabs', () => {
    // TreeView's "open with basic info" branch mints `tab-${node.id}` with no
    // endpointId on it at all.
    useTabsStore.setState({ tabs: [tab({ id: 'tab-ep-9' })], activeTabId: 'tab-ep-9' })
    expect(focusOpenTabFor('ep-9')).toBe(true)
  })

  it('reports false for a request that is not open, so the caller opens it', () => {
    useTabsStore.setState({
      tabs: [tab({ id: 'tab-ep-1', endpointId: 'ep-1' })],
      activeTabId: 'tab-ep-1',
    })
    expect(focusOpenTabFor('ep-2')).toBe(false)
    expect(switchActiveTab).not.toHaveBeenCalled()
  })

  it('leaves no trace when nothing is open at all', () => {
    expect(focusOpenTabFor('ep-1')).toBe(false)
    expect(switchActiveTab).not.toHaveBeenCalled()
  })
})

describe('the reported symptom (#112)', () => {
  it('keeps the response when the open request is clicked again in the tree', async () => {
    useTabsStore.setState({
      tabs: [tab({ id: 'tab-ep-1', endpointId: 'ep-1' })],
      activeTabId: 'tab-ep-1',
    })
    useResponseStore.getState().setResponse(response(200), 'tab-ep-1')
    expect(useResponseStore.getState().response?.status).toBe(200)

    // Clicking the row again used to run the full open path over the live tab.
    await openEndpointTab('ep-1')

    expect(useResponseStore.getState().byTab['tab-ep-1']?.response?.status).toBe(200)
    expect(switchActiveTab).toHaveBeenCalledWith('tab-ep-1')
  })

  it('does not go to the database for a tab it already has', async () => {
    const get = vi.fn(async () => ({ success: true, data: null }))
    ;(window as unknown as { api: unknown }).api = {
      savedRequest: { get },
      endpoint: { get },
    }
    useTabsStore.setState({
      tabs: [tab({ id: 'tab-ep-1', endpointId: 'ep-1' })],
      activeTabId: 'tab-ep-1',
    })

    await openEndpointTab('ep-1')

    // The DB copy is the older state — an open tab may hold unsaved edits.
    expect(get).not.toHaveBeenCalled()
  })
})
