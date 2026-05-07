import { create } from 'zustand'
import type {
  HttpMethod,
  KeyValuePair,
  RequestBody,
  AuthConfig,
  TestAssertion,
  ApiResponse,
  ConsoleLog,
} from '../types'
import { useResponseStore } from './response.store'
import { useTabsStore } from './tabs.store'
import { useEnvironmentStore } from './environment.store'
import { useWorkspaceStore } from './workspace.store'
import { useConsoleStore } from './console.store'
import {
  resolveVariables,
  resolveKeyValuePairs,
  resolveAuth,
  resolveRequestBody,
} from '../lib/variable-resolver'
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
  /**
   * Identifier of an in-flight `request:send` IPC call, if any. Set right
   * before `window.api.request.send(...)` is dispatched and cleared in the
   * `finally` of the same call. `cancelRequest` reads this to abort.
   */
  _inflightRequestId: string | null

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
  /** Abort the in-flight HTTP request, if any. No-op when nothing is in flight. */
  cancelRequest: () => Promise<void>
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
  _inflightRequestId: null,

  setMethod: (method) => set({ method }),
  setUrl: (url) => set({ url }),

  setParams: (params) => set({ params }),
  addParam: () => set((state) => ({ params: [...state.params, defaultKv()] })),
  updateParam: (id, updates) =>
    set((state) => ({
      params: state.params.map((p) => (p.id === id ? { ...p, ...updates } : p)),
    })),
  removeParam: (id) => set((state) => ({ params: state.params.filter((p) => p.id !== id) })),

  setHeaders: (headers) => set({ headers }),
  addHeader: () => set((state) => ({ headers: [...state.headers, defaultKv()] })),
  updateHeader: (id, updates) =>
    set((state) => ({
      headers: state.headers.map((h) => (h.id === id ? { ...h, ...updates } : h)),
    })),
  removeHeader: (id) => set((state) => ({ headers: state.headers.filter((h) => h.id !== id) })),

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
    const { method, url, params, headers, body, auth, preScript } = get()
    const responseStore = useResponseStore.getState()
    const tabsStore = useTabsStore.getState()
    const envStore = useEnvironmentStore.getState()
    const wsStore = useWorkspaceStore.getState()
    const activeTabId = tabsStore.activeTabId

    const preScriptLogs: ConsoleLog[] = []

    // Per-send variable overlay. Pre-request script can call
    // pm.environment.set / pm.variables.set — we fold those into this object
    // so that variable resolution below sees them on this request. Note that
    // these overrides are in-memory only; persisting to the environment store
    // would require the same plumbing the post-response script lacks today,
    // and introducing that is outside the scope of this change.
    const scriptOverrides: Record<string, string> = {}

    // Run pre-request script before variables are resolved so the script can
    // mutate them.
    if (preScript && preScript.trim()) {
      const activeVarsRecord = envStore.getActiveVariables()
      const envMap = new Map<string, string>(Object.entries(activeVarsRecord))
      const globalMap = new Map<string, string>()
      const globalVars = envStore.globalVariables || []
      for (const gv of globalVars) {
        if (gv.enabled) globalMap.set(gv.key, gv.value || gv.initialValue || '')
      }
      // Pre-request scripts don't read response — supply an empty shell so the
      // pm API contract is satisfied.
      const emptyResp: ApiResponse = { requestId: makeId(), protocol: 'http', timing: { total: 0 } }
      const pmApi = createPmApi(emptyResp, envMap, globalMap)
      const scriptResult = runScript(preScript, pmApi)
      // test-runner emits 'info'/'debug' via console.info/debug — flatten those
      // into 'log' so they satisfy ConsoleLog's narrower level union.
      for (const log of scriptResult.consoleLogs) {
        const level = log.level === 'error' ? 'error' : log.level === 'warn' ? 'warn' : 'log'
        preScriptLogs.push({ level, message: log.message, timestamp: log.timestamp })
      }
      Object.assign(scriptOverrides, scriptResult.globalUpdates, scriptResult.envUpdates)
    }

    // Resolve {{variable}} placeholders (after pre-request script has had
    // a chance to mutate env/globals).
    const activeVars = { ...envStore.getActiveVariables(), ...scriptOverrides }
    const resolvedUrl = resolveVariables(url, activeVars)
    const resolvedParams = resolveKeyValuePairs(
      params.filter((p) => p.enabled),
      activeVars,
    )
    const resolvedHeaders = resolveKeyValuePairs(
      headers.filter((h) => h.enabled),
      activeVars,
    )
    const resolvedBody = resolveRequestBody(body, activeVars) ?? body
    const resolvedAuth = resolveAuth(auth, activeVars)

    responseStore.setLoading(true)
    responseStore.clearResponse()
    if (activeTabId) {
      tabsStore.markLoading(activeTabId, true)
    }

    // Pull project-level request settings (timeout/ssl/proxy/tls) if available.
    // These are persisted by ProjectDetailModal under project.<id>.settings.
    interface ProjectNetSettings {
      requestTimeout?: number
      sslVerification?: boolean
      followRedirects?: boolean
      proxy?: {
        mode?: 'system' | 'none' | 'custom'
        host?: string
        port?: number
        bypass?: string
        auth?: { username: string; password: string }
      }
      tls?: {
        minVersion?: string
        maxVersion?: string
        cipherPreset?: 'modern' | 'intermediate' | 'legacy' | 'custom'
        ciphersCustom?: string
      }
    }
    let netSettings: ProjectNetSettings = {}
    if (wsStore.activeProjectId) {
      try {
        const res = (await window.api?.settings?.get(
          `project.${wsStore.activeProjectId}.settings`,
        )) as { success: boolean; data?: ProjectNetSettings } | undefined
        if (res?.success && res.data) netSettings = res.data
      } catch {
        /* ignore */
      }
    }

    // Forward TLS settings as-is — the main process (request handler) resolves
    // the cipher preset via `getCipherPreset` so the renderer never has to
    // import the main-process TLS preset constants.
    const tlsForEngine = netSettings.tls
      ? {
          minVersion: netSettings.tls.minVersion || undefined,
          maxVersion: netSettings.tls.maxVersion || undefined,
          cipherPreset: netSettings.tls.cipherPreset,
          ciphersCustom: netSettings.tls.ciphersCustom,
        }
      : undefined

    // Generate a per-call requestId so the user can hit Cancel during a slow
    // network round-trip. The main process tracks this id in its
    // `pendingRequests` map and aborts the underlying axios request when
    // `request:cancel` arrives.
    const requestId = makeId()
    set({ _inflightRequestId: requestId })

    try {
      const result = await window.api?.request?.send({
        method,
        url: resolvedUrl,
        params: resolvedParams as unknown[],
        headers: resolvedHeaders as unknown[],
        body: resolvedBody,
        auth: resolvedAuth,
        timeout: netSettings.requestTimeout,
        sslVerification: netSettings.sslVerification,
        followRedirects: netSettings.followRedirects,
        proxy: netSettings.proxy,
        tls: tlsForEngine,
        // History metadata
        _workspaceId: wsStore.activeWorkspaceId || undefined,
        _projectId: wsStore.activeProjectId || undefined,
        _tabId: activeTabId || undefined,
        _requestId: requestId,
      })

      // Convert resolved headers to Record<string,string> for console/history
      const headerRecord: Record<string, string> = {}
      for (const h of resolvedHeaders) headerRecord[h.key] = h.value
      const consoleReq = {
        method,
        url: resolvedUrl,
        headers: headerRecord,
        body: resolvedBody?.content,
        tabId: activeTabId || undefined,
        protocol: 'http' as const,
      }

      if (result?.success && result.data) {
        const apiResp = result.data as ApiResponse
        const { postScript: ps, assertions: asserts } = get()

        // Run post-response script and assertions
        const allTestResults = [...(apiResp.testResults || [])]
        const allConsoleLogs = [...(apiResp.consoleLogs || []), ...preScriptLogs]

        // Run built-in assertions
        if (asserts.length > 0) {
          const assertionResults = runAssertions(asserts, apiResp)
          allTestResults.push(...assertionResults)
        }

        // Run post-response script (pm.test, pm.expect, etc.)
        if (ps && ps.trim()) {
          const activeVarsRecord = { ...envStore.getActiveVariables(), ...scriptOverrides }
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

          // Persist `pm.environment.set(...)` / `pm.globals.set(...)` writes
          // back to the env store. Without this, scripts that capture a token
          // from the response would silently lose it on the next request.
          if (
            Object.keys(scriptResult.envUpdates).length > 0 ||
            Object.keys(scriptResult.globalUpdates).length > 0
          ) {
            void envStore.applyScriptUpdates(scriptResult.envUpdates, scriptResult.globalUpdates)
          }
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
      // IPC layer broken — main never logged anything. Push a synthetic
      // entry so the user can see the failure in the console panel.
      useConsoleStore.getState().addEntry({
        protocol: 'http',
        level: 'error',
        category: 'response',
        method,
        url,
        message: 'Request failed — IPC not available',
        tabId: activeTabId || undefined,
        details: { error: { message: 'Request failed — IPC not available' } },
      })
    } finally {
      responseStore.setLoading(false)
      if (activeTabId) {
        tabsStore.markLoading(activeTabId, false)
      }
      set((s) => (s._inflightRequestId === requestId ? { _inflightRequestId: null } : s))
    }
  },

  cancelRequest: async () => {
    const inflightId = get()._inflightRequestId
    if (!inflightId) return
    try {
      await window.api?.request?.cancel(inflightId)
    } catch {
      // Main may have already finished — local state will reset via the
      // sendRequest finally block; ignore the error here.
    }
    // The aborted axios call surfaces in the same sendRequest as a thrown
    // error, which falls into the catch above and renders an error response.
    // Clear the inflight marker eagerly so the UI flips back to "Send" even
    // if the abort beats the IPC reply.
    set({ _inflightRequestId: null })
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
