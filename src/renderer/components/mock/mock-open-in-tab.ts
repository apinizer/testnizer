/**
 * "Open in SSE tab" / "Start & open in SSE tab" for SSE mock servers (issue
 * #221, design Ek D §D.3.4) — the SSE twin of `openMockInMcpTab`
 * (`mock-mcp/mock-mcp-tabs.ts`).
 *
 * Ordering matters for the same reason as there: `openTab` only flips
 * `activeTabId`; the SSE store's live slice still belongs to the PREVIOUS
 * tab until the stores are activated, so the setters run after
 * `activateTabStores(id)`. The prefilled tab is a scratch tab: nothing in it
 * was typed by the user, so it is not dirty.
 *
 * The header targets an endpoint by the type's contract without loading any
 * response rows (KISS): the first exact-path GET / ANY endpoint.
 */
import { useTabsStore } from '../../stores/tabs.store'
import { useSseStore, type SseHttpMethod } from '../../stores/sse.store'
import { activateTabStores } from '../../lib/activate-tab'
import { makeTabId } from '../../lib/utils'
import { toast } from '../../lib/toast'
import type { MockEndpoint, MockMethod, MockServer } from '../../types'
import { mockServerUrl } from './mock-http-tabs'

const SSE_METHODS: readonly SseHttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

/** The SSE tab's method for an endpoint: ANY → GET; HEAD / OPTIONS / QUERY have none. */
export function sseMethodFor(method: MockMethod): SseHttpMethod | null {
  if (method === 'ANY') return 'GET'
  return (SSE_METHODS as readonly string[]).includes(method) ? (method as SseHttpMethod) : null
}

/** The endpoint the header button opens: the first exact-path GET / ANY one, or null. */
export function streamTargetEndpoint(endpoints: readonly MockEndpoint[]): MockEndpoint | null {
  return (
    endpoints.find((e) => e.pathMode === 'exact' && (e.method === 'GET' || e.method === 'ANY')) ??
    null
  )
}

/** Full URL of an endpoint path, reached through loopback when the server binds 0.0.0.0. */
export function mockEndpointUrl(
  server: Pick<MockServer, 'host' | 'port' | 'basePath'>,
  path: string,
): string {
  return `${mockServerUrl(server)}${path}`
}

export interface OpenMockSseTarget {
  name: string
  url: string
  method: SseHttpMethod
}

/** Open a new SSE request tab prefilled with the mock's URL and method. Returns the tab id. */
export function openMockInSseTab(o: OpenMockSseTarget): string {
  const id = makeTabId()
  useTabsStore.getState().openTab({ id, name: o.name, protocol: 'sse', url: '' })
  activateTabStores(id)
  const sse = useSseStore.getState()
  sse.setMethod(o.method)
  sse.setUrl(o.url)
  // A prefilled scratch tab holds nothing the user typed — no dirty dot.
  useTabsStore.getState().markDirty(id, false)
  return id
}

/**
 * The header button: start the server first when it is not running. A start
 * error is shown and NO tab opens (an SSE tab against a dead port would only
 * show a connection error). Returns the new tab id, or null.
 */
export async function startAndOpenMockInSseTab(
  o: OpenMockSseTarget & { running: boolean; start: () => Promise<string | null> },
): Promise<string | null> {
  if (!o.running) {
    const err = await o.start()
    if (err) {
      toast.error(err)
      return null
    }
  }
  return openMockInSseTab({ name: o.name, url: o.url, method: o.method })
}
