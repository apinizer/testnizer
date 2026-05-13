import type {
  HttpMethod,
  Protocol,
  KeyValuePair,
  RequestBody,
  AuthConfig,
  TestAssertion,
} from '../types'
import { useTabsStore } from '../stores/tabs.store'
import { useRequestStore } from '../stores/request.store'
import { useResponseStore } from '../stores/response.store'

/**
 * Open an endpoint or saved request in a new (or reused) preview tab and
 * hydrate the request store with its full DB-side configuration. Shared
 * between the APIs tree (TreeView), the Tests panel (suite endpoint rows),
 * and the Runner result detail pane so all three entry points land in the
 * same editor with the same loaded state.
 *
 * The two id sources (endpoints + saved_requests) are looked up in order,
 * mirroring `getRunnableEntity` in the main process.
 */
export async function openEndpointTab(id: string): Promise<void> {
  const tabId = `tab-${id}`

  // Try saved_requests first — the only place users land here from manually
  // created requests is the suite tree, and we want the cheaper lookup to
  // succeed early when the id is a saved request.
  try {
    const result = (await window.api?.savedRequest?.get(id)) as {
      success: boolean
      data?: {
        id: string
        name: string
        method: string
        url: string
        protocol: string
        params?: string
        headers?: string
        body?: string
        auth?: string
        pre_script?: string
        post_script?: string
        assertions?: string
      } | null
    }
    if (result?.success && result.data) {
      const sr = result.data
      const params = (sr.params ? JSON.parse(sr.params) : []) as KeyValuePair[]
      const headers = (sr.headers ? JSON.parse(sr.headers) : []) as KeyValuePair[]
      const body = (sr.body ? JSON.parse(sr.body) : { type: 'none' }) as RequestBody
      const auth = (sr.auth ? JSON.parse(sr.auth) : { type: 'none' }) as AuthConfig
      const assertions = (sr.assertions ? JSON.parse(sr.assertions) : []) as TestAssertion[]

      useTabsStore.getState().openPreviewTab({
        id: tabId,
        name: sr.name,
        protocol: (sr.protocol || 'http') as Protocol,
        method: sr.method || 'GET',
        url: sr.url,
        savedRequestId: sr.id,
      })
      const realTabId = useTabsStore.getState().activeTabId || tabId
      useRequestStore.getState().switchToTab(realTabId)
      useResponseStore.getState().clearResponse()
      useRequestStore.getState().loadFromEndpoint({
        method: (sr.method || 'GET') as HttpMethod,
        url: sr.url,
        params,
        headers,
        body,
        auth,
        preScript: sr.pre_script ?? '',
        postScript: sr.post_script ?? '',
        assertions,
      })
      return
    }
  } catch {
    /* fall through to endpoint lookup */
  }

  // Imported endpoints — request_schema holds the full configuration.
  try {
    const result = (await window.api?.endpoint?.get(id)) as {
      success: boolean
      data?: {
        id: string
        name: string
        method: string
        path: string
        protocol: string
        request_schema?: string
      } | null
    }
    if (result?.success && result.data) {
      const ep = result.data
      const protocol = (ep.protocol || 'http') as Protocol
      let params: KeyValuePair[] = []
      let headers: KeyValuePair[] = []
      let body: RequestBody = { type: 'none' }
      let auth: AuthConfig = { type: 'none' }
      let preScript = ''
      let postScript = ''
      let assertions: TestAssertion[] = []
      let url = ep.path
      let method = ep.method || 'GET'

      if (ep.request_schema) {
        try {
          const schema = JSON.parse(ep.request_schema)
          params = schema.params || []
          headers = schema.headers || []
          body = schema.body || { type: 'none' }
          auth = schema.auth || { type: 'none' }
          preScript = schema.preScript ?? ''
          postScript = schema.postScript ?? ''
          assertions = schema.assertions ?? []
          if (schema.url) url = schema.url
          if (schema.method) method = schema.method
        } catch {
          /* ignore */
        }
      }

      useTabsStore.getState().openPreviewTab({
        id: tabId,
        name: ep.name,
        protocol,
        method,
        url,
        endpointId: ep.id,
      })
      const realTabId = useTabsStore.getState().activeTabId || tabId
      useRequestStore.getState().switchToTab(realTabId)
      useResponseStore.getState().clearResponse()
      useRequestStore.getState().loadFromEndpoint({
        method: method as HttpMethod,
        url,
        params,
        headers,
        body,
        auth,
        preScript,
        postScript,
        assertions,
      })
    }
  } catch {
    /* ignore — caller will see nothing change */
  }
}

/**
 * Open a test-suite item in a tab. Items are inline request snapshots that
 * live independently of the APIs-tree endpoints (the "copy on add" model),
 * so the editor reads from / writes to `testSuiteItem.*` rather than
 * `endpoint.*` / `savedRequest.*`. The tab carries `testSuiteItemId` so
 * the Save path can route to the right IPC.
 *
 * For now this only wires the HTTP-family stores (params / headers / body /
 * scripts / assertions). Protocol-specific stores (SOAP / GraphQL / gRPC /
 * WS / SSE / Socket.IO / MCP / AI) are loaded with the same `loadFromEndpoint`
 * shape — every protocol store accepts that input. If a protocol needs a
 * specialised `loadFromSuiteItem` later, it can be added without breaking
 * callers.
 */
export async function openSuiteItemTab(id: string, opts?: { pinned?: boolean }): Promise<void> {
  const tabId = `tab-${id}`
  try {
    const result = (await window.api?.testSuiteItem?.get(id)) as {
      success: boolean
      data?: {
        id: string
        suite_id: string
        folder_id: string | null
        protocol: string
        name: string
        method: string | null
        url: string | null
        request_schema: string
        assertions: string | null
      } | null
    }
    if (!result?.success || !result.data) return
    const item = result.data
    const protocol = (item.protocol || 'http') as Protocol

    // Parse the inline snapshot. Anything missing falls back to the empty
    // request shape so a freshly-created item (request_schema = '{}') opens
    // cleanly in the editor.
    let params: KeyValuePair[] = []
    let headers: KeyValuePair[] = []
    let body: RequestBody = { type: 'none' }
    let auth: AuthConfig = { type: 'none' }
    let preScript = ''
    let postScript = ''
    try {
      const schema = JSON.parse(item.request_schema || '{}')
      params = schema.params || []
      headers = schema.headers || []
      body = schema.body || { type: 'none' }
      auth = schema.auth || { type: 'none' }
      preScript = schema.preScript ?? ''
      postScript = schema.postScript ?? ''
    } catch {
      /* malformed schema — keep defaults */
    }
    const assertions = (item.assertions ? JSON.parse(item.assertions) : []) as TestAssertion[]

    // Newly-created items (handleAddItem) want their own pinned tab so two
    // fresh requests don't share the single preview slot. Plain click-from-
    // tree falls through to the preview slot (one transient tab, replaced
    // on next click). Either way the dedup check inside the tabs store
    // matches on testSuiteItemId, so activating an already-open item just
    // focuses its existing tab.
    const tabsApi = useTabsStore.getState()
    const tabPayload = {
      id: tabId,
      name: item.name,
      protocol,
      method: item.method ?? 'GET',
      url: item.url ?? '',
      testSuiteItemId: item.id,
    }
    if (opts?.pinned) {
      tabsApi.openTab(tabPayload)
    } else {
      tabsApi.openPreviewTab(tabPayload)
    }
    const realTabId = useTabsStore.getState().activeTabId || tabId
    useRequestStore.getState().switchToTab(realTabId)
    useResponseStore.getState().clearResponse()
    useRequestStore.getState().loadFromEndpoint({
      method: (item.method ?? 'GET') as HttpMethod,
      url: item.url ?? '',
      params,
      headers,
      body,
      auth,
      preScript,
      postScript,
      assertions,
    })
  } catch {
    /* ignore */
  }
}
