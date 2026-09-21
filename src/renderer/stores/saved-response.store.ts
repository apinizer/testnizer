// Named response examples pinned to a request (issue #125) — the "Save
// response" action next to Send. Rows live in SQLite (`saved_responses`),
// travel with the project file / Git sync, and are keyed by the request the
// tab is backed by (endpoint / saved request / test-suite item).

import { create } from 'zustand'
import type {
  ApiResponse,
  SavedRequestSnapshot,
  SavedResponse,
  SavedResponseOwnerType,
  Tab,
} from '../types'
import { useTabsStore } from './tabs.store'
import { useResponseStore } from './response.store'
import { useRequestStore } from './request.store'
import { useWorkspaceStore } from './workspace.store'
import { openExampleTab } from '../lib/open-example-tab'

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

/**
 * The request side of an example: the editor template (`configured`) and the
 * resolved wire request the engine reported (`sent`). `sent` is what the
 * example view shows by default — after variables and pre-request scripts —
 * so "{{employee_body}}" reads as the JSON that actually went out. Auth is
 * reduced to its type; the credential never enters the snapshot. Bodies
 * above the cap are dropped like the response body.
 */
export function buildRequestSnapshot(
  req: Pick<
    ReturnType<typeof useRequestStore.getState>,
    'method' | 'url' | 'params' | 'headers' | 'body' | 'auth'
  >,
  response: Pick<ApiResponse, 'actualRequest'>,
): SavedRequestSnapshot {
  const cap = (text: string | undefined): string | undefined =>
    text && text.length > SAVED_RESPONSE_BODY_LIMIT ? undefined : text
  const configured: SavedRequestSnapshot['configured'] = {
    method: req.method,
    url: req.url,
    params: req.params,
    headers: req.headers,
    body: { ...req.body, content: cap(req.body?.content) },
    authType: req.auth?.type,
  }
  const sent = response.actualRequest
    ? { ...response.actualRequest, body: cap(response.actualRequest.body) }
    : undefined
  return { configured, sent }
}

/** Parse a stored `request_json`; null when absent or malformed (pre-column rows). */
export function parseRequestSnapshot(json: string | null | undefined): SavedRequestSnapshot | null {
  if (!json) return null
  try {
    const parsed = JSON.parse(json) as Partial<SavedRequestSnapshot>
    if (!parsed || typeof parsed !== 'object' || !parsed.configured) return null
    return parsed as SavedRequestSnapshot
  } catch {
    return null
  }
}

/**
 * The APIs tree lists examples under their owner row, so every write must
 * rebuild it — and a fresh example should be visible right away, which means
 * the owner row is expanded before the refresh (refreshTree keeps openNodeIds).
 * Best-effort: the row is already persisted; a tree failure must not undo that.
 */
async function syncTree(expandOwnerId?: string): Promise<void> {
  try {
    const ws = useWorkspaceStore.getState()
    if (expandOwnerId && !ws.openNodeIds.has(expandOwnerId)) ws.toggleNode(expandOwnerId)
    await ws.refreshTree()
  } catch {
    /* tree catches up on the next reload */
  }
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
  /**
   * Open a saved example in its own read-only tab (resolved request +
   * response). Never touches the live request editor.
   */
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
        request_json: JSON.stringify(buildRequestSnapshot(req, response)),
      })
      if (!res?.success || !res.data) return { ok: false, error: res?.error || 'save-failed' }
      if (get().ownerKey === ownerKey(owner)) {
        set({ items: [res.data as SavedResponse, ...get().items] })
      } else {
        await get().load(owner)
      }
      // Suite items live in the Tests panel, not the APIs tree.
      if (owner.type !== 'test_suite_item') await syncTree(owner.id)
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
      // A tab showing the deleted example has nothing left to show.
      const tabs = useTabsStore.getState()
      const openTab = tabs.tabs.find((t) => t.savedResponseId === id)
      if (openTab) tabs.closeTab(openTab.id)
      await syncTree()
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
      const tabs = useTabsStore.getState()
      const openTab = tabs.tabs.find((t) => t.savedResponseId === id)
      if (openTab) tabs.updateTab(openTab.id, { name: name.trim() })
      await syncTree()
      return true
    } catch {
      return false
    }
  },

  open: (item) => {
    const tabs = useTabsStore.getState()
    const ownerTab = tabs.tabs.find((t) => t.id === tabs.activeTabId)
    openExampleTab(item, ownerTab?.name)
  },
}))

// Keep the list pointed at whichever request the active tab is backed by.
useTabsStore.subscribe((state, prev) => {
  if (state.activeTabId === prev.activeTabId) return
  const tab = state.tabs.find((t) => t.id === state.activeTabId)
  void useSavedResponseStore.getState().load(savedResponseOwnerForTab(tab))
})
