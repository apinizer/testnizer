// Named response examples pinned to a request (issue #125) — the "Save
// response" action next to Send. Rows live in SQLite (`saved_responses`),
// travel with the project file / Git sync, and are keyed by the request the
// tab is backed by (endpoint / saved request / test-suite item).

import { create } from 'zustand'
import type { ApiResponse, SavedResponse, SavedResponseOwnerType, Tab } from '../types'
import { useTabsStore } from './tabs.store'
import { useResponseStore } from './response.store'
import { useRequestStore } from './request.store'

export interface SavedResponseOwner {
  type: SavedResponseOwnerType
  id: string
}

/** Which persisted row a tab is backed by — null for unsaved scratch tabs. */
export function savedResponseOwnerForTab(
  tab: Pick<Tab, 'endpointId' | 'savedRequestId' | 'testSuiteItemId'> | undefined | null,
): SavedResponseOwner | null {
  if (!tab) return null
  if (tab.endpointId) return { type: 'endpoint', id: tab.endpointId }
  if (tab.savedRequestId) return { type: 'saved_request', id: tab.savedRequestId }
  if (tab.testSuiteItemId) return { type: 'test_suite_item', id: tab.testSuiteItemId }
  return null
}

/** Same cap the history snapshot applies — bodies above it are dropped. */
export const SAVED_RESPONSE_BODY_LIMIT = 500_000

/** Strip transient fields and cap the body before persisting. */
export function serializeResponseForSave(response: ApiResponse): string {
  const snapshot: Partial<ApiResponse> = {
    protocol: response.protocol,
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
    body:
      response.body && response.body.length > SAVED_RESPONSE_BODY_LIMIT ? undefined : response.body,
    bodyEncoding: response.bodyEncoding,
    bodySize: response.bodySize,
    timing: response.timing,
    error: response.error,
    cookies: response.cookies,
    testResults: response.testResults,
    actualRequest: response.actualRequest,
  }
  return JSON.stringify(snapshot)
}

/** Default label offered in the name prompt, e.g. "200 OK". */
export function defaultSavedResponseName(response: ApiResponse): string {
  if (response.status)
    return `${response.status}${response.statusText ? ' ' + response.statusText : ''}`
  return response.error ? 'Error' : 'Response'
}

function ownerKey(owner: SavedResponseOwner | null): string | null {
  return owner ? `${owner.type}:${owner.id}` : null
}

interface SavedResponseStore {
  /** Owner the current list belongs to. */
  ownerKey: string | null
  items: SavedResponse[]
  loading: boolean

  load: (owner: SavedResponseOwner | null) => Promise<void>
  /** Persist the active tab's current response under `name`. */
  saveCurrent: (name: string) => Promise<{ ok: boolean; error?: string; bodyDropped?: boolean }>
  remove: (id: string) => Promise<boolean>
  rename: (id: string, name: string) => Promise<boolean>
  /** Show a saved example in the active tab's response pane. */
  open: (item: SavedResponse) => void
}

export const useSavedResponseStore = create<SavedResponseStore>((set, get) => ({
  ownerKey: null,
  items: [],
  loading: false,

  load: async (owner) => {
    const key = ownerKey(owner)
    if (!owner || !key) {
      set({ ownerKey: null, items: [], loading: false })
      return
    }
    // Owner CHANGED: clear immediately so the previous request's examples
    // never flash under the new tab's header. Same owner: keep the current
    // list while refetching — clearing here made the "saved-only" panel
    // unmount (count 0), remount when the fetch landed, and re-trigger a load
    // from its own effect → an infinite mount/unmount loop.
    if (get().ownerKey !== key) set({ ownerKey: key, items: [], loading: true })
    else set({ loading: true })
    try {
      const res = await window.api?.savedResponse?.list(owner.type, owner.id)
      // A slower load for a tab we already left must not clobber the new list.
      if (get().ownerKey !== key) return
      set({ items: res?.success && res.data ? (res.data as SavedResponse[]) : [], loading: false })
    } catch {
      if (get().ownerKey === key) set({ items: [], loading: false })
    }
  },

  saveCurrent: async (name) => {
    const tabs = useTabsStore.getState()
    const tab = tabs.tabs.find((t) => t.id === tabs.activeTabId)
    const owner = savedResponseOwnerForTab(tab)
    if (!owner) return { ok: false, error: 'unsaved-request' }
    const response = useResponseStore.getState().response
    if (!response) return { ok: false, error: 'no-response' }
    const req = useRequestStore.getState()
    const bodyDropped = Boolean(response.body && response.body.length > SAVED_RESPONSE_BODY_LIMIT)
    try {
      // project_id is resolved in main from the owner row (a tab backed by
      // another project's request must not be stamped with the active one).
      const res = await window.api?.savedResponse?.create({
        owner_type: owner.type,
        owner_id: owner.id,
        name,
        protocol: response.protocol || tab?.protocol || 'http',
        method: tab?.method || req.method || null,
        url: response.actualRequest?.url || tab?.url || req.url || null,
        status_code: response.status ?? null,
        response_json: serializeResponseForSave(response),
      })
      if (!res?.success || !res.data) return { ok: false, error: res?.error || 'save-failed' }
      if (get().ownerKey === ownerKey(owner)) {
        set({ items: [res.data as SavedResponse, ...get().items] })
      } else {
        await get().load(owner)
      }
      return { ok: true, bodyDropped }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  },

  remove: async (id) => {
    try {
      const res = await window.api?.savedResponse?.delete(id)
      if (!res?.success) return false
      set({ items: get().items.filter((i) => i.id !== id) })
      return true
    } catch {
      return false
    }
  },

  rename: async (id, name) => {
    try {
      const res = await window.api?.savedResponse?.rename(id, name)
      if (!res?.success) return false
      set({ items: get().items.map((i) => (i.id === id ? { ...i, name: name.trim() } : i)) })
      return true
    } catch {
      return false
    }
  },

  open: (item) => {
    let snap: Partial<ApiResponse> = {}
    try {
      snap = JSON.parse(item.response_json) as Partial<ApiResponse>
    } catch {
      snap = {}
    }
    const activeTabId = useTabsStore.getState().activeTabId
    useResponseStore.getState().setResponse(
      {
        requestId: `saved-${item.id}`,
        protocol: (snap.protocol || item.protocol || 'http') as ApiResponse['protocol'],
        status: snap.status ?? item.status_code ?? undefined,
        statusText: snap.statusText,
        headers: snap.headers,
        body: snap.body,
        bodyEncoding: snap.bodyEncoding,
        bodySize: snap.bodySize,
        timing: snap.timing || { total: 0 },
        error: snap.error,
        cookies: snap.cookies,
        testResults: snap.testResults,
        actualRequest: snap.actualRequest,
      },
      activeTabId,
    )
  },
}))

// Keep the list pointed at whichever request the active tab is backed by.
useTabsStore.subscribe((state, prev) => {
  if (state.activeTabId === prev.activeTabId) return
  const tab = state.tabs.find((t) => t.id === state.activeTabId)
  void useSavedResponseStore.getState().load(savedResponseOwnerForTab(tab))
})
