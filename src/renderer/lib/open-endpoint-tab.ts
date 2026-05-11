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
