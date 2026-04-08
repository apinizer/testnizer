import { create } from 'zustand'
import type {
  HttpMethod,
  KeyValuePair,
  RequestBody,
  AuthConfig,
  TestAssertion,
  ApiResponse,
} from '../types'
import { useResponseStore } from './response.store'
import { useTabsStore } from './tabs.store'

function makeId(): string {
  return Math.random().toString(36).substring(2, 10)
}

function defaultKv(key = '', value = '', enabled = true): KeyValuePair {
  return { id: makeId(), key, value, enabled }
}

/** Snapshot of request state for a single tab */
interface TabRequestState {
  method: HttpMethod
  url: string
  params: KeyValuePair[]
  headers: KeyValuePair[]
  body: RequestBody
  auth: AuthConfig
  preScript: string
  postScript: string
  assertions: TestAssertion[]
}

function emptyTabState(): TabRequestState {
  return {
    method: 'GET',
    url: '',
    params: [],
    headers: [],
    body: { type: 'none' },
    auth: { type: 'none' },
    preScript: '',
    postScript: '',
    assertions: [],
  }
}

interface RequestStore extends TabRequestState {
  /** Per-tab state cache */
  _tabStates: Map<string, TabRequestState>
  _currentTabId: string | null

  setMethod: (method: HttpMethod) => void
  setUrl: (url: string) => void
  setParams: (params: KeyValuePair[]) => void
  addParam: () => void
  updateParam: (id: string, updates: Partial<KeyValuePair>) => void
  removeParam: (id: string) => void
  setHeaders: (headers: KeyValuePair[]) => void
  addHeader: () => void
  updateHeader: (id: string, updates: Partial<KeyValuePair>) => void
  removeHeader: (id: string) => void
  setBody: (body: RequestBody) => void
  setAuth: (auth: AuthConfig) => void
  setPreScript: (script: string) => void
  setPostScript: (script: string) => void
  setAssertions: (assertions: TestAssertion[]) => void
  addAssertion: () => void
  removeAssertion: (id: string) => void
  sendRequest: () => Promise<void>
  loadFromEndpoint: (data: {
    method: HttpMethod
    url: string
    params?: KeyValuePair[]
    headers?: KeyValuePair[]
    body?: RequestBody
    auth?: AuthConfig
  }) => void

  /** Switch active tab — saves current state and loads target tab state */
  switchToTab: (tabId: string) => void
  /** Remove cached state for a closed tab */
  removeTabState: (tabId: string) => void
}

function extractState(s: RequestStore): TabRequestState {
  return {
    method: s.method,
    url: s.url,
    params: s.params,
    headers: s.headers,
    body: s.body,
    auth: s.auth,
    preScript: s.preScript,
    postScript: s.postScript,
    assertions: s.assertions,
  }
}

export const useRequestStore = create<RequestStore>((set, get) => ({
  ...emptyTabState(),
  _tabStates: new Map(),
  _currentTabId: null,

  setMethod: (method) => set({ method }),
  setUrl: (url) => set({ url }),

  setParams: (params) => set({ params }),
  addParam: () =>
    set((state) => ({ params: [...state.params, defaultKv()] })),
  updateParam: (id, updates) =>
    set((state) => ({
      params: state.params.map((p) => (p.id === id ? { ...p, ...updates } : p)),
    })),
  removeParam: (id) =>
    set((state) => ({ params: state.params.filter((p) => p.id !== id) })),

  setHeaders: (headers) => set({ headers }),
  addHeader: () =>
    set((state) => ({ headers: [...state.headers, defaultKv()] })),
  updateHeader: (id, updates) =>
    set((state) => ({
      headers: state.headers.map((h) => (h.id === id ? { ...h, ...updates } : h)),
    })),
  removeHeader: (id) =>
    set((state) => ({ headers: state.headers.filter((h) => h.id !== id) })),

  setBody: (body) => set({ body }),
  setAuth: (auth) => set({ auth }),
  setPreScript: (script) => set({ preScript: script }),
  setPostScript: (script) => set({ postScript: script }),
  setAssertions: (assertions) => set({ assertions }),

  addAssertion: () =>
    set((state) => ({
      assertions: [
        ...state.assertions,
        {
          id: makeId(),
          name: 'New assertion',
          type: 'status_equals',
          enabled: true,
          expected: 200,
        },
      ],
    })),

  removeAssertion: (id) =>
    set((state) => ({
      assertions: state.assertions.filter((a) => a.id !== id),
    })),

  switchToTab: (tabId) => {
    const state = get()
    const tabStates = new Map(state._tabStates)

    // Save current tab state
    if (state._currentTabId) {
      tabStates.set(state._currentTabId, extractState(state))
    }

    // Load target tab state (or empty for new tabs)
    const target = tabStates.get(tabId) || emptyTabState()

    set({
      ...target,
      _tabStates: tabStates,
      _currentTabId: tabId,
    })
  },

  removeTabState: (tabId) => {
    const tabStates = new Map(get()._tabStates)
    tabStates.delete(tabId)
    set({ _tabStates: tabStates })
  },

  sendRequest: async () => {
    const { method, url, params, headers, body, auth } = get()
    const responseStore = useResponseStore.getState()
    const tabsStore = useTabsStore.getState()
    const activeTabId = tabsStore.activeTabId

    responseStore.setLoading(true)
    responseStore.clearResponse()
    if (activeTabId) {
      tabsStore.markLoading(activeTabId, true)
    }

    try {
      const result = await window.api?.request?.send({
        method,
        url,
        params: params.filter((p) => p.enabled) as unknown[],
        headers: headers.filter((h) => h.enabled) as unknown[],
        body,
        auth,
      })

      if (result?.success && result.data) {
        responseStore.setResponse(result.data as ApiResponse)
      } else {
        responseStore.setResponse({
          requestId: makeId(),
          protocol: 'http',
          error: result?.error || 'Request failed',
          timing: { total: 0 },
        })
      }
    } catch {
      responseStore.setResponse({
        requestId: makeId(),
        protocol: 'http',
        error: 'Request failed — IPC not available',
        timing: { total: 0 },
      })
    } finally {
      responseStore.setLoading(false)
      if (activeTabId) {
        tabsStore.markLoading(activeTabId, false)
      }
    }
  },

  loadFromEndpoint: (data) => {
    set({
      method: data.method,
      url: data.url,
      params: data.params || [],
      headers: data.headers || [],
      body: data.body || { type: 'none' },
      auth: data.auth || { type: 'none' },
    })
  },
}))
