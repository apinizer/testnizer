/**
 * "Open in SSE tab" / "Open in AI Chat tab" / "Open in request tab" (and their
 * "Start & open …" forms) for HTTP-table mock servers (issue #221, design Ek D §D.3.4–D.3.5)
 * — the twins of `openMockInMcpTab` (`mock-mcp/mock-mcp-tabs.ts`).
 *
 * Ordering matters for the same reason as there: `openTab` only flips
 * `activeTabId`; a protocol store's live slice still belongs to the PREVIOUS
 * tab until the stores are activated, so the setters run after
 * `activateTabStores(id)`. The prefilled tab is a scratch tab: nothing in it
 * was typed by the user, so it is not dirty.
 *
 * The header targets an endpoint by the type's contract without loading any
 * response rows (KISS): SSE → the first exact-path GET / ANY endpoint; AI →
 * the first exact POST / ANY `…/chat/completions`, else the first exact POST
 * that is not an Anthropic `…/messages` path; AI (Anthropic) → the first
 * exact POST / ANY `…/messages` (issue #222).
 */
import { useTabsStore } from '../../stores/tabs.store'
import { useSseStore, type SseHttpMethod } from '../../stores/sse.store'
import { useAiChatStore } from '../../stores/ai-chat.store'
import { useRequestStore } from '../../stores/request.store'
import { makeId } from '../../lib/utils'
import { activateTabStores } from '../../lib/activate-tab'
import { toast } from '../../lib/toast'
import type { HttpMethod, MockEndpoint, MockMethod, MockServer } from '../../types'
import { mockServerUrl } from './mock-http-tabs'
import { MOCK_LLM_MODEL } from './mock-ai-presets'
import {
  focusMockClientTab,
  mockClientTabKey,
  mockClientTabName,
  newMockClientTabId,
} from './mock-client-tab'

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

/**
 * The endpoint the AI header button opens: the first exact POST / ANY one
 * whose path ends with `/chat/completions`, else the first exact POST one —
 * except an Anthropic `/messages` path: this button opens the Custom
 * (OpenAI-format) provider, which reads an Anthropic event stream as an empty
 * answer. `/messages` has its own button (`anthropicTargetEndpoint`, issue
 * #222). Null = no one-click target.
 */
export function chatTargetEndpoint(endpoints: readonly MockEndpoint[]): MockEndpoint | null {
  const exact = endpoints.filter((e) => e.pathMode === 'exact')
  return (
    exact.find(
      (e) => (e.method === 'POST' || e.method === 'ANY') && /\/chat\/completions$/.test(e.path),
    ) ??
    exact.find((e) => e.method === 'POST' && !/\/messages$/.test(e.path)) ??
    null
  )
}

/**
 * The endpoint "Open in AI Chat (Anthropic)" opens (issue #222): the first
 * exact POST / ANY one whose path ends with `/messages`. Null = none.
 */
export function anthropicTargetEndpoint(endpoints: readonly MockEndpoint[]): MockEndpoint | null {
  return (
    endpoints.find(
      (e) =>
        e.pathMode === 'exact' &&
        (e.method === 'POST' || e.method === 'ANY') &&
        /\/messages$/.test(e.path),
    ) ?? null
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
  /** The mock server — with the method and path, the key of its one client tab. */
  serverId: string
  name: string
  url: string
  method: SseHttpMethod
  /** The endpoint path: header and per-endpoint buttons of one endpoint share a tab. */
  path: string
}

/**
 * Open the SSE request tab of a mock endpoint, prefilled with its URL and
 * method, and connect it (PM review #20 — "Open in SSE tab" used to leave it
 * Disconnected). A second click focuses that tab instead of opening another
 * (its config is left as the user has it) and reconnects it when it is not
 * connected. Returns the tab id.
 */
export function openMockInSseTab(o: OpenMockSseTarget): string {
  const key = mockClientTabKey('sse', o.serverId, `${o.method} ${o.path}`)
  const open = focusMockClientTab(key)
  if (open) {
    connectSseIfIdle()
    return open
  }
  const id = newMockClientTabId(key)
  useTabsStore.getState().openTab({ id, name: mockClientTabName(o.name), protocol: 'sse', url: '' })
  activateTabStores(id)
  const sse = useSseStore.getState()
  sse.setMethod(o.method)
  sse.setUrl(o.url)
  // A prefilled scratch tab holds nothing the user typed — no dirty dot.
  useTabsStore.getState().markDirty(id, false)
  connectSseIfIdle()
  return id
}

/** Connect the ACTIVE SSE tab unless it is connected or connecting already. */
function connectSseIfIdle(): void {
  const sse = useSseStore.getState()
  if (sse.connectionState === 'connected' || sse.connectionState === 'connecting') return
  void sse.connect()
}

export interface OpenMockHttpTarget {
  /** The mock server — with the method and path, the key of its one client tab. */
  serverId: string
  name: string
  url: string
  method: HttpMethod
  /** The endpoint path: a second click on the same endpoint focuses its tab. */
  path: string
  /** Headers and JSON body the endpoint expects (`mockRequestShape`, shared with cURL). */
  headers: readonly { name: string; value: string }[]
  body: string | null
  /**
   * Send right after opening — false while the URL still has `:param`
   * placeholders, and for an endpoint with an SSE reply (a looping or held-open
   * stream would leave a plain Send waiting until its timeout).
   */
  send: boolean
}

/**
 * Open a plain HTTP request tab for a mock endpoint, prefilled with its method,
 * URL and the headers / JSON body the cURL copy carries, and send it (the twin
 * of `openMockInSseTab`, which connects). It is an ordinary unsaved request
 * tab: Send any method, Save / Save As, credential withholding — all the
 * normal tab machinery. A second click focuses that tab and does NOT send
 * again: the user may have edited it.
 *
 * Auth is `none`, not the new-request default `inherit`: the tab sends on its
 * own, and inheriting would hand the project's real credential to the mock
 * (and its request log) without the user asking — the rule the AI Chat twin
 * keeps with `savedKeyDisabled`. The mock's own tokens are never copied in
 * either. Returns the tab id.
 */
export function openMockInHttpTab(o: OpenMockHttpTarget): string {
  const key = mockClientTabKey('http', o.serverId, `${o.method} ${o.path}`)
  const open = focusMockClientTab(key)
  if (open) return open
  const id = newMockClientTabId(key)
  useTabsStore.getState().openTab({
    id,
    name: mockClientTabName(o.name),
    protocol: 'http',
    method: o.method,
    url: o.url,
  })
  activateTabStores(id)
  const req = useRequestStore.getState()
  req.setMethod(o.method)
  req.setUrl(o.url)
  req.setHeaders(
    o.headers.map((h) => ({ id: makeId(), key: h.name, value: h.value, enabled: true })),
  )
  req.setBody(o.body === null ? { type: 'none' } : { type: 'json', content: o.body })
  req.setAuth({ type: 'none' })
  // A prefilled scratch tab holds nothing the user typed — no dirty dot.
  useTabsStore.getState().markDirty(id, false)
  if (o.send) void useRequestStore.getState().sendRequest()
  return id
}

export function startAndOpenMockInHttpTab(
  o: OpenMockHttpTarget & StartThenOpen,
): Promise<string | null> {
  return startThenOpen(o, () =>
    openMockInHttpTab({
      serverId: o.serverId,
      name: o.name,
      url: o.url,
      method: o.method,
      path: o.path,
      headers: o.headers,
      body: o.body,
      send: o.send,
    }),
  )
}

export interface OpenMockAiChatTarget {
  /** The mock server — with the provider, the key of its one AI Chat tab. */
  serverId: string
  name: string
  /** The full chat endpoint URL — the provider posts to it as it is. */
  url: string
  /** Default `mock-model` (what GET /v1/models lists). */
  model?: string
  /**
   * The wire the tab speaks: `custom` (OpenAI chat completions, default) or
   * `anthropic` (Anthropic messages, issue #222).
   */
  provider?: 'custom' | 'anthropic'
}

/**
 * Open a new AI Chat tab pointed at the mock's chat endpoint (§D.3.5, issue
 * #222): the Custom provider for the OpenAI-compatible endpoint, the
 * Anthropic provider for `…/v1/messages`. Returns the tab id.
 *
 * No saved key reaches the mock, by ONE rule for both: the tab is marked
 * `savedKeyDisabled` FIRST, before any provider / URL change could load a
 * key — the Anthropic provider's key scope is the provider itself, whatever
 * the URL, so without the mark the user's real Anthropic key would be sent
 * as `x-api-key`. A key the user types into the tab is still used.
 *
 * Anthropic: the provider is set BEFORE the URL — `setProvider` replaces the
 * URL with the provider's default (`api.anthropic.com`).
 */
export function openMockInAiChatTab(o: OpenMockAiChatTarget): string {
  // One tab per server and provider (PM review #20): a second click focuses
  // it — its conversation and settings stay as they are.
  const key = mockClientTabKey('ai', o.serverId, `${o.provider ?? 'custom'} ${o.url}`)
  const open = focusMockClientTab(key)
  if (open) return open
  const id = newMockClientTabId(key)
  useTabsStore.getState().openTab({ id, name: mockClientTabName(o.name), protocol: 'ai', url: '' })
  activateTabStores(id)
  const ai = useAiChatStore.getState()
  ai.setSavedKeyDisabled(true)
  if (o.provider === 'anthropic') {
    ai.setProvider('anthropic')
    ai.setCustomUrl(o.url)
  } else {
    ai.setCustomUrl(o.url)
    ai.setProvider('custom')
  }
  ai.setModel(o.model ?? MOCK_LLM_MODEL)
  useTabsStore.getState().markDirty(id, false)
  return id
}

export interface StartThenOpen {
  running: boolean
  start: () => Promise<string | null>
}

/**
 * The header buttons' one path: start the server first when it is not
 * running. A start error is shown and NO tab opens (a tab against a dead port
 * would only show a connection error). `open` runs after the start, so it can
 * read what the start produced (the Mock MCP live URL). Returns the new tab
 * id, or null.
 */
export async function startThenOpen(o: StartThenOpen, open: () => string): Promise<string | null> {
  if (!o.running) {
    const err = await o.start()
    if (err) {
      toast.error(err)
      return null
    }
  }
  return open()
}

export function startAndOpenMockInSseTab(
  o: OpenMockSseTarget & StartThenOpen,
): Promise<string | null> {
  return startThenOpen(o, () =>
    openMockInSseTab({
      serverId: o.serverId,
      name: o.name,
      url: o.url,
      method: o.method,
      path: o.path,
    }),
  )
}

export function startAndOpenMockInAiChatTab(
  o: OpenMockAiChatTarget & StartThenOpen,
): Promise<string | null> {
  return startThenOpen(o, () =>
    openMockInAiChatTab({
      serverId: o.serverId,
      name: o.name,
      url: o.url,
      model: o.model,
      provider: o.provider,
    }),
  )
}
