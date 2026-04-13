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
import { useEnvironmentStore } from './environment.store'
import { useWorkspaceStore } from './workspace.store'
import { useConsoleStore } from './console.store'
import { resolveVariables, resolveKeyValuePairs } from '../lib/variable-resolver'
import { runAssertions, runScript, createPmApi } from '../lib/test-runner'

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
    const envStore = useEnvironmentStore.getState()
    const wsStore = useWorkspaceStore.getState()
    const activeTabId = tabsStore.activeTabId

    // Resolve {{variable}} placeholders
    const activeVars = envStore.getActiveVariables()
    const resolvedUrl = resolveVariables(url, activeVars)
    const resolvedParams = resolveKeyValuePairs(
      params.filter((p) => p.enabled),
      activeVars
    )
    const resolvedHeaders = resolveKeyValuePairs(
      headers.filter((h) => h.enabled),
      activeVars
    )
    const resolvedBody = body.content
      ? { ...body, content: resolveVariables(body.content, activeVars) }
      : body

    responseStore.setLoading(true)
    responseStore.clearResponse()
    if (activeTabId) {
      tabsStore.markLoading(activeTabId, true)
    }

    try {
      const result = await window.api?.request?.send({
        method,
        url: resolvedUrl,
        params: resolvedParams as unknown[],
        headers: resolvedHeaders as unknown[],
        body: resolvedBody,
        auth,
        // History metadata
        _workspaceId: wsStore.activeWorkspaceId || undefined,
        _projectId: wsStore.activeProjectId || undefined,
      })

      // Convert resolved headers to Record<string,string> for console/history
      const headerRecord: Record<string, string> = {}
      for (const h of resolvedHeaders) headerRecord[h.key] = h.value
      const consoleReq = {
        method,
        url: resolvedUrl,
        headers: headerRecord,
        body: resolvedBody?.content,
      }

      if (result?.success && result.data) {
        const apiResp = result.data as ApiResponse
        const { postScript: ps, assertions: asserts } = get()

        // Run post-response script and assertions
        const allTestResults = [...(apiResp.testResults || [])]
        const allConsoleLogs = [...(apiResp.consoleLogs || [])]

        // Run built-in assertions
        if (asserts.length > 0) {
          const assertionResults = runAssertions(asserts, apiResp)
          allTestResults.push(...assertionResults)
        }

        // Run post-response script (pm.test, pm.expect, etc.)
        if (ps && ps.trim()) {
          const activeVarsRecord = envStore.getActiveVariables()
          const envMap = new Map<string, string>(Object.entries(activeVarsRecord))
          const globalMap = new Map<string, string>()
          // Populate global vars
          const globalVars = envStore.globalVariables || []
          for (const gv of globalVars) {
            if (gv.enabled) globalMap.set(gv.key, gv.value || gv.initialValue || '')
          }

          const pmApi = createPmApi(apiResp, envMap, globalMap)
          const scriptResult = runScript(ps, pmApi)
          allTestResults.push(...scriptResult.results)
          allConsoleLogs.push(...scriptResult.consoleLogs)
        }

        // Merge test results and console logs into response
        const enrichedResp: ApiResponse = {
          ...apiResp,
          testResults: allTestResults.length > 0 ? allTestResults : undefined,
          consoleLogs: allConsoleLogs.length > 0 ? allConsoleLogs : undefined,
        }

        responseStore.setResponse(enrichedResp)
        useConsoleStore.getState().addFromResponse(consoleReq, enrichedResp)
      } else {
        const errResp: ApiResponse = {
          requestId: makeId(),
          protocol: 'http',
          error: result?.error || 'Request failed',
          timing: { total: 0 },
        }
        responseStore.setResponse(errResp)
        useConsoleStore.getState().addFromResponse(consoleReq, errResp)
      }
    } catch {
      const errResp: ApiResponse = {
        requestId: makeId(),
        protocol: 'http',
        error: 'Request failed — IPC not available',
        timing: { total: 0 },
      }
      responseStore.setResponse(errResp)
      useConsoleStore.getState().addFromResponse(
        { method, url, headers: {} },
        errResp
      )
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
