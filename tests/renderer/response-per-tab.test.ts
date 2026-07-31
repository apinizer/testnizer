/**
 * Response state belongs to a tab, not to the window (issue #76).
 *
 * `response` and `isLoading` were single values shared by every tab, so the
 * state of whichever request ran last leaked across the whole UI:
 *
 *   - fire a slow request in tab A, switch to tab B, and B's Send button was a
 *     red **Cancel** — pressing it aborted A's request;
 *   - B's response pane showed A's spinner, then A's response;
 *   - A's response, arriving late, overwrote whatever B was showing.
 *
 * The store now keys by tab and mirrors the ACTIVE tab's slice into the fields
 * every reader already uses, so these tests drive it exactly the way the app
 * does: write with the tab the request started in, read after switching.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useResponseStore } from '../../src/renderer/stores/response.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import type { ApiResponse, Tab } from '../../src/renderer/types'

const A = 'tab-a'
const B = 'tab-b'

function tab(id: string): Tab {
  return { id, name: id, protocol: 'http', isDirty: false, isLoading: false } as Tab
}

function resp(body: string): ApiResponse {
  return { requestId: body, protocol: 'http', status: 200, body, timing: { total: 1 } } as ApiResponse
}

/** What the UI would render right now. */
const shown = () => {
  const s = useResponseStore.getState()
  return { isLoading: s.isLoading, body: s.response?.body ?? null }
}

beforeEach(() => {
  useTabsStore.setState({ tabs: [tab(A), tab(B)], activeTabId: A })
  useResponseStore.setState({ byTab: {}, activeTabId: A, response: null, isLoading: false })
})

describe('a request in flight is only in flight for its own tab', () => {
  it('does not put another tab into the loading state', () => {
    useResponseStore.getState().setLoading(true, A)
    expect(shown().isLoading).toBe(true)

    useTabsStore.getState().setActiveTab(B)

    // The bug: B showed A's spinner and B's Send button became Cancel.
    expect(shown().isLoading).toBe(false)
  })

  it('restores the loading state when you switch back', () => {
    useResponseStore.getState().setLoading(true, A)
    useTabsStore.getState().setActiveTab(B)
    useTabsStore.getState().setActiveTab(A)

    expect(shown().isLoading).toBe(true)
  })
})

describe('a response lands in the tab that asked for it', () => {
  it('does not overwrite what another tab is showing', () => {
    useResponseStore.getState().setResponse(resp('B-result'), B)
    useResponseStore.getState().setLoading(true, A)
    useTabsStore.getState().setActiveTab(B)

    // A's slow response arrives while the user is looking at B.
    useResponseStore.getState().setResponse(resp('A-result'), A)

    expect(shown().body).toBe('B-result')
    useTabsStore.getState().setActiveTab(A)
    expect(shown().body).toBe('A-result')
  })

  it('clears the loading state of its own tab only', () => {
    useResponseStore.getState().setLoading(true, A)
    useResponseStore.getState().setLoading(true, B)

    useResponseStore.getState().setResponse(resp('A-result'), A)

    expect(useResponseStore.getState().byTab[A].isLoading).toBe(false)
    expect(useResponseStore.getState().byTab[B].isLoading).toBe(true)
  })

  it('clears only the named tab', () => {
    useResponseStore.getState().setResponse(resp('A-result'), A)
    useResponseStore.getState().setResponse(resp('B-result'), B)

    useResponseStore.getState().clearResponse(B)

    expect(useResponseStore.getState().byTab[A].response?.body).toBe('A-result')
    expect(useResponseStore.getState().byTab[B].response).toBeNull()
  })
})

describe('the implicit target is the tab in front of the user', () => {
  it('writes to the active tab when no id is given', () => {
    // History rows and endpoint opens legitimately mean "the current tab".
    useResponseStore.getState().setResponse(resp('from-history'))
    expect(useResponseStore.getState().byTab[A].response?.body).toBe('from-history')
    expect(useResponseStore.getState().byTab[B]).toBeUndefined()
  })
})

describe('closing a tab releases its response', () => {
  it('drops the slice so responses do not accumulate for the session', () => {
    useResponseStore.getState().setResponse(resp('A-result'), A)
    useResponseStore.getState().setResponse(resp('B-result'), B)

    useTabsStore.setState({ tabs: [tab(A)], activeTabId: A })

    expect(useResponseStore.getState().byTab[B]).toBeUndefined()
    expect(useResponseStore.getState().byTab[A].response?.body).toBe('A-result')
  })
})

describe('the store still works with no tabs at all', () => {
  it('keeps a response written before any tab exists', () => {
    // Quick Test shell, and the first render before a tab is opened. Dropping
    // the write because there was no tab to key it by would be the same silent
    // swallow this refactor exists to avoid.
    useTabsStore.setState({ tabs: [], activeTabId: null })
    useResponseStore.setState({ byTab: {}, activeTabId: null, response: null, isLoading: false })

    useResponseStore.getState().setLoading(true)
    expect(shown().isLoading).toBe(true)

    useResponseStore.getState().setResponse(resp('detached'))
    expect(shown()).toEqual({ isLoading: false, body: 'detached' })
  })

  it('does not discard that slice when unrelated tabs close', () => {
    useTabsStore.setState({ tabs: [], activeTabId: null })
    useResponseStore.setState({ byTab: {}, activeTabId: null, response: null, isLoading: false })
    useResponseStore.getState().setResponse(resp('detached'))

    useTabsStore.setState({ tabs: [tab(A)], activeTabId: null })

    expect(shown().body).toBe('detached')
  })
})
