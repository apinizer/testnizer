/**
 * Issue #112 — the response disappeared when you left a tab and came back.
 *
 * Responses have been keyed by tab since issue #76, but the tab strip's own
 * switch handler still carried a leftover from the single-response era:
 *
 *     switchToTab(tabId)      // protocol stores
 *     ...
 *     clearResponse()         // ← no tab id
 *     setActiveTab(tabId)     // ← the active tab only changes HERE
 *
 * `clearResponse()` with no id means "the tab in front of the user", and at
 * that moment that was still the tab being LEFT. So every switch threw away
 * the response of the tab you were switching away from; returning to it showed
 * an empty pane, exactly as if the request had never been sent.
 *
 * Closing a tab had the mirror-image version of the same bug: the clear ran
 * after the store had already re-pointed at the surviving tab, so closing tab
 * B wiped tab A's response.
 *
 * These tests drive `switchActiveTab` — the function the tab strip now calls —
 * so the ordering is covered where it actually broke.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useResponseStore } from '../../src/renderer/stores/response.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { switchActiveTab } from '../../src/renderer/lib/activate-tab'
import type { ApiResponse, Tab } from '../../src/renderer/types'

const A = 'tab-a'
const B = 'tab-b'

function tab(id: string): Tab {
  return {
    id,
    name: id,
    protocol: 'http',
    method: 'GET',
    url: '',
    isDirty: false,
    isLoading: false,
  } as Tab
}

function resp(body: string): ApiResponse {
  return {
    requestId: body,
    protocol: 'http',
    status: 200,
    body,
    timing: { total: 1 },
  } as ApiResponse
}

/** What the response pane would render right now. */
const shownBody = () => useResponseStore.getState().response?.body ?? null

beforeEach(() => {
  useTabsStore.setState({ tabs: [tab(A), tab(B)], activeTabId: A })
  useResponseStore.setState({ byTab: {}, activeTabId: A, response: null, isLoading: false })
})

describe('switching tabs keeps each tab’s response', () => {
  it('does not discard the response of the tab being left', () => {
    useResponseStore.getState().setResponse(resp('A body'), A)
    expect(shownBody()).toBe('A body')

    switchActiveTab(B)

    // B never ran anything, so B's pane is empty …
    expect(shownBody()).toBe(null)
    // … but A's response must still be there, not cleared on the way out.
    expect(useResponseStore.getState().byTab[A]?.response?.body).toBe('A body')
  })

  it('shows the response again when you come back', () => {
    useResponseStore.getState().setResponse(resp('A body'), A)

    switchActiveTab(B)
    switchActiveTab(A)

    // The reported symptom: this used to be null — "as if it was never sent".
    expect(shownBody()).toBe('A body')
  })

  it('keeps both tabs’ responses independently across repeated switches', () => {
    useResponseStore.getState().setResponse(resp('A body'), A)
    switchActiveTab(B)
    useResponseStore.getState().setResponse(resp('B body'), B)

    switchActiveTab(A)
    expect(shownBody()).toBe('A body')
    switchActiveTab(B)
    expect(shownBody()).toBe('B body')
  })

  it('leaves the response alone when the switch is a no-op', () => {
    useResponseStore.getState().setResponse(resp('A body'), A)
    switchActiveTab(A)
    expect(shownBody()).toBe('A body')
  })
})

describe('closing a tab keeps the surviving tab’s response', () => {
  it('does not wipe the tab that becomes active', () => {
    useResponseStore.getState().setResponse(resp('A body'), A)
    switchActiveTab(B)
    useResponseStore.getState().setResponse(resp('B body'), B)
    switchActiveTab(A)

    useTabsStore.getState().closeTab(B)

    expect(shownBody()).toBe('A body')
    // The closed tab's slice is released by the store's own subscription.
    expect(useResponseStore.getState().byTab[B]).toBeUndefined()
  })
})
