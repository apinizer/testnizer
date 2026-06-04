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
import { loadTabbedState, attachTabbedPersist } from '../lib/persist-helpers'
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
import { makeId } from '../lib/utils'

function markActiveDirty(): void {
  const { activeTabId, tabs, markDirty } = useTabsStore.getState()
  if (!activeTabId) return
  const tab = tabs.find((t) => t.id === activeTabId)
  if (tab?.endpointId || tab?.savedRequestId) {
    markDirty(activeTabId, true)
  }
}

function defaultKv(key = '', value = '', enabled = true): KeyValuePair {
  return { id: makeId(), key, value, enabled }
}

// ─── URL ⇄ Query-param sync (issue #22) ───────────────────────
// The URL bar and the Params tab were independent: adding a param never
// touched the URL. Keep them in lockstep without encoding (so `{{vars}}`
// survive intact, matching what the URL bar renders) and without losing
// disabled rows.
function buildQueryString(params: KeyValuePair[]): string {
  return params
    .filter((p) => p.enabled && p.key.trim() !== '')
    .map((p) => (p.value !== '' ? `${p.key}=${p.value}` : p.key))
    .join('&')
}

/** Rewrite the URL's query string from the current params (enabled only). */
function applyParamsToUrl(url: string, params: KeyValuePair[]): string {
  const base = url.split('?')[0]
  const qs = buildQueryString(params)
  return qs ? `${base}?${qs}` : base
}

/**
 * Derive params from the URL's query, preserving any disabled rows the user
 * set in the Params tab (those never appear in the URL). Enabled rows are
 * rebuilt from the query.
 */
function mergeParamsFromUrl(url: string, existing: KeyValuePair[]): KeyValuePair[] {
  const qIdx = url.indexOf('?')
  const fromUrl: KeyValuePair[] = []
  if (qIdx !== -1) {
    const qs = url.slice(qIdx + 1)
    for (const pair of qs.split('&')) {
      if (!pair) continue
      const eq = pair.indexOf('=')
      const key = eq === -1 ? pair : pair.slice(0, eq)
      const value = eq === -1 ? '' : pair.slice(eq + 1)
      fromUrl.push({ id: makeId(), key, value, enabled: true })
    }
  }
  const disabled = existing.filter((p) => !p.enabled)
  return [...fromUrl, ...disabled]
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
  // ── Per-request Settings tab (issues #24-27). These override the
  // project-level network defaults on the Send path. `requestTimeout` is in
  // ms; 0 = no timeout (honored by the engine). Defaults mirror axios sanity:
  // follow redirects up to 5, verify SSL, no timeout.
  followRedirects: boolean
  maxRedirects: number
  sslVerification: boolean
  requestTimeout: number
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
    followRedirects: true,
    maxRedirects: 5,
    sslVerification: true,
    requestTimeout: 0,
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
  setFollowRedirects: (v: boolean) => void
  setMaxRedirects: (v: number) => void
  setSslVerification: (v: boolean) => void
  setRequestTimeout: (v: number) => void
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
    preScript?: string
    postScript?: string
    assertions?: TestAssertion[]
    followRedirects?: boolean
    maxRedirects?: number
    sslVerification?: boolean
    requestTimeout?: number
  }) => void

  /** Switch active tab — saves current state and loads target tab state */
  switchToTab: (tabId: string) => void
  /** Remove cached state for a closed tab */
  removeTabState: (tabId: string) => void
  /**
   * Copy a tab's cached state to a new tab id. Used by the tab bar's
   * "Duplicate Tab" action so the cloned tab inherits unsaved edits, not
   * just the metadata stored on the Tab object.
   */
  cloneTabState: (srcTabId: string, dstTabId: string) => void
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
    followRedirects: s.followRedirects,
    maxRedirects: s.maxRedirects,
    sslVerification: s.sslVerification,
    requestTimeout: s.requestTimeout,
  }
}

// ─── Persistence ──────────────────────────────────────────────
const STORAGE_KEY = 'testnizer-request'
const persisted = loadTabbedState<TabRequestState>(STORAGE_KEY, emptyTabState)

export const useRequestStore = create<RequestStore>((set, get) => ({
  ...persisted.current,
  // Backfill the per-request settings for states persisted before these
  // fields existed (would otherwise spread in as `undefined`).
  followRedirects: persisted.current.followRedirects ?? true,
  maxRedirects: persisted.current.maxRedirects ?? 5,
  sslVerification: persisted.current.sslVerification ?? true,
  requestTimeout: persisted.current.requestTimeout ?? 0,
  _tabStates: persisted._tabStates,
  _currentTabId: persisted._currentTabId,
  _inflightRequestId: null,

  setMethod: (method) => {
    set({ method })
    markActiveDirty()
  },
  setUrl: (url) => {
    // Keep the Params tab in sync with the query the user typed (#22).
    set((state) => ({ url, params: mergeParamsFromUrl(url, state.params) }))
    markActiveDirty()
  },

  setParams: (params) => {
    set((state) => ({ params, url: applyParamsToUrl(state.url, params) }))
    markActiveDirty()
  },
  addParam: () => {
    set((state) => {
      const params = [...state.params, defaultKv()]
      return { params, url: applyParamsToUrl(state.url, params) }
    })
    markActiveDirty()
  },
  updateParam: (id, updates) => {
    set((state) => {
      const params = state.params.map((p) => (p.id === id ? { ...p, ...updates } : p))
      return { params, url: applyParamsToUrl(state.url, params) }
    })
    markActiveDirty()
  },
  removeParam: (id) => {
    set((state) => {
      const params = state.params.filter((p) => p.id !== id)
      return { params, url: applyParamsToUrl(state.url, params) }
    })
    markActiveDirty()
  },

  setHeaders: (headers) => {
    set({ headers })
    markActiveDirty()
  },
  addHeader: () => {
    set((state) => ({ headers: [...state.headers, defaultKv()] }))
    markActiveDirty()
  },
  updateHeader: (id, updates) => {
    set((state) => ({
      headers: state.headers.map((h) => (h.id === id ? { ...h, ...updates } : h)),
    }))
    markActiveDirty()
  },
  removeHeader: (id) => {
    set((state) => ({ headers: state.headers.filter((h) => h.id !== id) }))
    markActiveDirty()
  },

  setBody: (body) => {
    set({ body })
    markActiveDirty()
  },
  setAuth: (auth) => {
    set({ auth })
    markActiveDirty()
  },
  setPreScript: (script) => {
    set({ preScript: script })
    markActiveDirty()
  },
  setPostScript: (script) => {
    set({ postScript: script })
    markActiveDirty()
  },
  setAssertions: (assertions) => {
    set({ assertions })
    markActiveDirty()
  },

  addAssertion: () => {
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
    }))
    markActiveDirty()
  },

  removeAssertion: (id) => {
    set((state) => ({
      assertions: state.assertions.filter((a) => a.id !== id),
    }))
    markActiveDirty()
  },

  setFollowRedirects: (v) => {
    set({ followRedirects: v })
    markActiveDirty()
  },
  setMaxRedirects: (v) => {
    set({ maxRedirects: Number.isFinite(v) && v >= 0 ? v : 0 })
    markActiveDirty()
  },
  setSslVerification: (v) => {
    set({ sslVerification: v })
    markActiveDirty()
  },
  setRequestTimeout: (v) => {
    set({ requestTimeout: Number.isFinite(v) && v >= 0 ? v : 0 })
    markActiveDirty()
  },

  switchToTab: (tabId) => {
    const state = get()
    const tabStates = new Map(state._tabStates)

    // Save current tab state
    if (state._currentTabId) {
      tabStates.set(state._currentTabId, extractState(state))
    }

    // Cap the cache at MAX_CACHED_TAB_STATES entries to keep idle memory
    // bounded. v1.3.1 M16 reported ~560 MB resident with 7 endpoints + 1
    // mock — most of which was per-tab Monaco state + cached request state
    // that never got evicted. We drop the oldest entry (insertion order)
    // when we exceed the cap, skipping the incoming tab so a brand-new
    // switch never thrashes its own state out.
    const MAX_CACHED_TAB_STATES = 20
    while (tabStates.size > MAX_CACHED_TAB_STATES) {
      const oldest = tabStates.keys().next().value
      if (oldest === tabId || oldest === undefined) break
      tabStates.delete(oldest)
    }

    // Load target tab state (or empty for new tabs). Merge over emptyTabState
    // so fields added later (per-request settings #24-27) default cleanly when
    // restoring a cache entry persisted before those fields existed.
    const target = { ...emptyTabState(), ...tabStates.get(tabId) }

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

  cloneTabState: (srcTabId, dstTabId) => {
    const state = get()
    // Pull from cache, but if the source tab is the currently-loaded one its
    // latest edits live on the live state — not in the cache yet.
    const srcState =
      state._currentTabId === srcTabId ? extractState(state) : state._tabStates.get(srcTabId)
    if (!srcState) return
    const tabStates = new Map(state._tabStates)
    // KV/asssertion arrays carry stable ids — re-stamp them so future edits
    // on the duplicate don't accidentally mutate the source via a shared id.
    tabStates.set(dstTabId, {
      ...srcState,
      params: srcState.params.map((p) => ({ ...p, id: makeId() })),
      headers: srcState.headers.map((h) => ({ ...h, id: makeId() })),
      assertions: srcState.assertions.map((a) => ({ ...a, id: makeId() })),
    })
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

    // Header overrides produced by pm.request.headers.{add,upsert,remove}.
    // Folded into the resolved headers below so script-driven auth/correlation
    // headers actually ship on the wire (Mehmet BUG-02).
    let preScriptHeaders: { key: string; value: string }[] | null = null
    let preScriptSkippedRequest = false

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
      const requestName = tabsStore.tabs.find((tt) => tt.id === activeTabId)?.name ?? ''
      // Populate pm.request with the user-typed values so the script can read
      // method/url/headers BEFORE variable resolution (Mehmet BUG-01).
      const pmApi = createPmApi(emptyResp, envMap, globalMap, {
        eventName: 'prerequest',
        requestName,
        request: {
          method,
          url,
          headers: headers.filter((h) => h.enabled).map((h) => ({ key: h.key, value: h.value })),
        },
      })
      const scriptResult = await runScript(preScript, pmApi)
      // test-runner emits 'info'/'debug' via console.info/debug — flatten those
      // into 'log' so they satisfy ConsoleLog's narrower level union.
      for (const log of scriptResult.consoleLogs) {
        const level = log.level === 'error' ? 'error' : log.level === 'warn' ? 'warn' : 'log'
        preScriptLogs.push({ level, message: log.message, timestamp: log.timestamp })
      }
      Object.assign(scriptOverrides, scriptResult.globalUpdates, scriptResult.envUpdates)
      preScriptHeaders = scriptResult.requestHeaders
      preScriptSkippedRequest = scriptResult.skipRequest
    }

    // pm.execution.skipRequest() — abort the actual HTTP send. Surface the
    // skip in console + tab spinner cleanup so the user knows it ran.
    if (preScriptSkippedRequest) {
      const skipMsg = 'Request skipped by pm.execution.skipRequest() in pre-request script'
      preScriptLogs.push({ level: 'warn', message: skipMsg, timestamp: Date.now() })
      const reqName = tabsStore.tabs.find((tt) => tt.id === activeTabId)?.name ?? ''
      useConsoleStore.getState().addEntry({
        protocol: 'http',
        level: 'warning',
        category: 'system',
        method,
        url,
        message: `${reqName}${reqName ? ' — ' : ''}${skipMsg}`,
        scriptLogs: preScriptLogs.map((l) => ({
          level: l.level === 'error' ? 'error' : l.level === 'warn' ? 'warn' : 'log',
          message: l.message,
          timestamp: l.timestamp,
        })),
      })
      if (activeTabId) tabsStore.markLoading(activeTabId, false)
      responseStore.setLoading(false)
      return
    }

    // Resolve {{variable}} placeholders (after pre-request script has had
    // a chance to mutate env/globals).
    const activeVars = { ...envStore.getActiveVariables(), ...scriptOverrides }
    const resolvedUrl = resolveVariables(url, activeVars)
    const resolvedParams = resolveKeyValuePairs(
      params.filter((p) => p.enabled),
      activeVars,
    )
    let resolvedHeaders = resolveKeyValuePairs(
      headers.filter((h) => h.enabled),
      activeVars,
    )

    // Fold pm.request.headers mutations from the pre-request script into the
    // outgoing header list. HeaderCollection is case-insensitive, so an upsert
    // of `Authorization` overrides any user-typed entry with the same name
    // regardless of casing (Mehmet BUG-02 + BUG-03).
    if (preScriptHeaders) {
      const seen = new Set<string>()
      const merged: typeof resolvedHeaders = []
      for (const h of preScriptHeaders) {
        const lk = h.key.toLowerCase()
        if (seen.has(lk)) continue
        seen.add(lk)
        merged.push({ key: h.key, value: h.value, enabled: true })
      }
      resolvedHeaders = merged
    }
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

    // Per-request Settings tab (#24-27) override the project-level network
    // defaults. These now actually reach the engine: timeout (0 = no timeout),
    // maxRedirects, followRedirects, and SSL verification. Falling back to the
    // project value only when a per-request field is somehow absent.
    const reqCfg = get()

    try {
      const result = await window.api?.request?.send({
        method,
        url: resolvedUrl,
        params: resolvedParams as unknown[],
        headers: resolvedHeaders as unknown[],
        body: resolvedBody,
        auth: resolvedAuth,
        timeout: reqCfg.requestTimeout ?? netSettings.requestTimeout,
        maxRedirects: reqCfg.maxRedirects,
        sslVerification: reqCfg.sslVerification ?? netSettings.sslVerification,
        followRedirects: reqCfg.followRedirects ?? netSettings.followRedirects,
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

          const requestName = tabsStore.tabs.find((tt) => tt.id === activeTabId)?.name ?? ''
          const pmApi = createPmApi(apiResp, envMap, globalMap, {
            eventName: 'test',
            requestName,
          })
          const scriptResult = await runScript(ps, pmApi)
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
    const state = get()
    const newFields = {
      method: data.method,
      url: data.url,
      params: data.params || [],
      headers: data.headers || [],
      body: data.body || { type: 'none' },
      auth: data.auth || { type: 'none' },
      preScript: data.preScript ?? '',
      postScript: data.postScript ?? '',
      assertions: data.assertions ?? [],
      followRedirects: data.followRedirects ?? true,
      maxRedirects: data.maxRedirects ?? 5,
      sslVerification: data.sslVerification ?? true,
      requestTimeout: data.requestTimeout ?? 0,
    }
    // ALSO refresh the per-tab cache for the current tab. Without this,
    // closing and reopening a test-suite item (or any tab) would restore
    // the stale `_tabStates` snapshot instead of the freshly-loaded DB
    // data — saved changes appeared lost (v1.4.2 T-5.2).
    if (state._currentTabId) {
      const tabStates = new Map(state._tabStates)
      const prev = tabStates.get(state._currentTabId) ?? emptyTabState()
      tabStates.set(state._currentTabId, { ...prev, ...newFields })
      set({ ...newFields, _tabStates: tabStates })
    } else {
      set(newFields)
    }
  },
}))

attachTabbedPersist(useRequestStore, STORAGE_KEY, extractState, (s) => ({
  _tabStates: s._tabStates,
  _currentTabId: s._currentTabId,
}))
