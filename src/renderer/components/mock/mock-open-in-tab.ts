/**
 * "Open in SSE tab" / "Open in AI Chat tab" (and their "Start & open …"
 * forms) for SSE and AI mock servers (issue #221, design Ek D §D.3.4–D.3.5)
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
 * that is not an Anthropic `…/messages` path.
 */
import { useTabsStore } from '../../stores/tabs.store'
import { useSseStore, type SseHttpMethod } from '../../stores/sse.store'
import { useAiChatStore } from '../../stores/ai-chat.store'
import { activateTabStores } from '../../lib/activate-tab'
import { makeTabId } from '../../lib/utils'
import { toast } from '../../lib/toast'
import type { MockEndpoint, MockMethod, MockServer } from '../../types'
import { mockServerUrl } from './mock-http-tabs'
import { MOCK_LLM_MODEL } from './mock-ai-presets'

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
 * except an Anthropic `/messages` path: the AI Chat tab is opened on the
 * Custom (OpenAI-format) provider, which reads an Anthropic event stream as
 * an empty answer, and the Anthropic provider would send the saved Anthropic
 * key (§D.3.5). Null = no one-click target.
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

export interface OpenMockAiChatTarget {
  name: string
  /** The full chat endpoint URL — the Custom provider posts to it as it is. */
  url: string
  /** Default `mock-model` (what GET /v1/models lists). */
  model?: string
}

/**
 * Open a new AI Chat tab on the Custom provider, pointed at the mock's chat
 * endpoint (§D.3.5). Returns the tab id.
 *
 * The URL is set BEFORE the provider: while the provider is still the fresh
 * tab's OpenAI, the URL edit changes no key scope; picking Custom then lands
 * straight on the mock's own scope (`custom:http://127.0.0.1:<port>`), which
 * has no stored key — so the key field is empty and no credential header is
 * sent. The other order passes through `custom:https://api.openai.com` (the
 * fresh tab's default URL), and a key carried there in memory would follow
 * the URL edit to the mock.
 */
export function openMockInAiChatTab(o: OpenMockAiChatTarget): string {
  const id = makeTabId()
  useTabsStore.getState().openTab({ id, name: o.name, protocol: 'ai', url: '' })
  activateTabStores(id)
  const ai = useAiChatStore.getState()
  ai.setCustomUrl(o.url)
  ai.setProvider('custom')
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
 * would only show a connection error). Returns the new tab id, or null.
 */
async function startThenOpen(o: StartThenOpen, open: () => string): Promise<string | null> {
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
  return startThenOpen(o, () => openMockInSseTab({ name: o.name, url: o.url, method: o.method }))
}

export function startAndOpenMockInAiChatTab(
  o: OpenMockAiChatTarget & StartThenOpen,
): Promise<string | null> {
  return startThenOpen(o, () => openMockInAiChatTab({ name: o.name, url: o.url, model: o.model }))
}
