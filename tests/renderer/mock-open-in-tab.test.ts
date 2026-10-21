/**
 * "Open in SSE tab" / "Start & open in SSE tab" for SSE mock servers and
 * "Open in AI Chat tab" for AI mock servers (issue #221, design Ek D
 * §D.3.4–D.3.5).
 *
 * The SSE request tab must be prefilled in the NEW tab's slice (the stores
 * are activated before the setters run), carry the endpoint's method (ANY →
 * GET), and stay clean — it holds nothing the user typed. "Start & open"
 * opens nothing when the server fails to start.
 *
 * AI: the AI Chat tab opens on the Custom provider with the mock's chat URL
 * and model `mock-model`, and its key field stays EMPTY — neither the saved
 * OpenAI key nor a key carried in memory from another Custom URL may reach
 * the mock (§D.3.5).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import './mock-http-bridge-stub'

vi.mock('../../src/renderer/lib/toast', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}))

import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useSseStore } from '../../src/renderer/stores/sse.store'
import { resetAiKeySessionForTests, useAiChatStore } from '../../src/renderer/stores/ai-chat.store'
import { toast } from '../../src/renderer/lib/toast'
import {
  chatTargetEndpoint,
  mockEndpointUrl,
  openMockInAiChatTab,
  openMockInSseTab,
  startAndOpenMockInAiChatTab,
  sseMethodFor,
  startAndOpenMockInSseTab,
  streamTargetEndpoint,
} from '../../src/renderer/components/mock/mock-open-in-tab'
import { httpEndpoint, httpServer } from './mock-http-bridge-stub'

/** Keys main's encrypted store would hand out: the saved OpenAI provider key. */
const SAVED_KEYS: Record<string, string> = { openai: 'sk-real-openai' }
const aiChatApi = {
  getKey: vi.fn(async (scope: string) => ({
    success: true,
    data: { key: SAVED_KEYS[scope] ?? '', encryptionAvailable: true },
  })),
  setKey: vi.fn(async () => ({
    success: true,
    data: { persisted: true, encryptionAvailable: true },
  })),
}
;(window as unknown as { api: Record<string, unknown> }).api.aiChat = aiChatApi

/** Let every pending key lookup (`loadKeyFromMain`) settle. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0))
}

beforeEach(() => {
  useTabsStore.setState({ tabs: [], activeTabId: null })
  vi.mocked(toast.error).mockClear()
  resetAiKeySessionForTests()
})

describe('openMockInSseTab', () => {
  it('opens an SSE tab with the URL and method, active and not dirty, titled "<name> · client"', () => {
    const id = openMockInSseTab({
      serverId: 's1',
      name: 'Ticker SSE',
      url: 'http://127.0.0.1:3200/events',
      method: 'POST',
      path: '/events',
    })
    const { tabs, activeTabId } = useTabsStore.getState()
    expect(activeTabId).toBe(id)
    const tab = tabs.find((t) => t.id === id)
    // PM review #20: not the editor tab's bare server name.
    expect(tab).toMatchObject({ protocol: 'sse', name: 'Ticker SSE · client', isDirty: false })
    const sse = useSseStore.getState()
    expect(sse._currentTabId).toBe(id)
    expect(sse.url).toBe('http://127.0.0.1:3200/events')
    expect(sse.method).toBe('POST')
  })

  it('connects the new tab right away (PM review #20: it used to stay Disconnected)', () => {
    const connect = vi.fn(async () => {})
    useSseStore.setState({ connect, connectionState: 'disconnected' })
    const id = openMockInSseTab({
      serverId: 's1',
      name: 'A',
      url: 'http://127.0.0.1:3200/a',
      method: 'GET',
      path: '/a',
    })
    expect(connect).toHaveBeenCalledTimes(1)
    expect(useSseStore.getState()._currentTabId).toBe(id)
  })

  it('the same endpoint again focuses its tab — no duplicate, the edited URL kept; another endpoint is another tab', () => {
    const a = openMockInSseTab({
      serverId: 's1',
      name: 'A',
      url: 'http://127.0.0.1:3200/a',
      method: 'GET',
      path: '/a',
    })
    useSseStore.getState().setUrl('http://127.0.0.1:3200/a?edited=1')
    const b = openMockInSseTab({
      serverId: 's1',
      name: 'A',
      url: 'http://127.0.0.1:3200/b',
      method: 'GET',
      path: '/b',
    })
    expect(b).not.toBe(a)
    expect(useTabsStore.getState().tabs).toHaveLength(2)

    const connect = vi.fn(async () => {})
    useSseStore.setState({ connect })
    const again = openMockInSseTab({
      serverId: 's1',
      name: 'A',
      url: 'http://127.0.0.1:3200/a',
      method: 'GET',
      path: '/a',
    })
    expect(again).toBe(a)
    expect(useTabsStore.getState().tabs).toHaveLength(2)
    expect(useTabsStore.getState().activeTabId).toBe(a)
    const sse = useSseStore.getState()
    expect(sse._currentTabId).toBe(a)
    expect(sse.url).toBe('http://127.0.0.1:3200/a?edited=1')
    // Not connected → the focused tab reconnects.
    expect(connect).toHaveBeenCalledTimes(1)
  })

  it('Open after closing the tab is a fresh tab — no state of the closed one comes back', () => {
    const first = openMockInSseTab({
      serverId: 's1',
      name: 'A',
      url: 'http://127.0.0.1:3200/a',
      method: 'GET',
      path: '/a',
    })
    // The closed tab was live and connected; closing the ACTIVE tab keeps the
    // store's live slice under its id (cleanup-tab-state → removeTabState).
    useSseStore.setState({ connectionState: 'connected', url: 'http://stale/' })
    useSseStore.getState().removeTabState(first)
    useTabsStore.getState().closeTab(first)

    const connect = vi.fn(async () => {})
    useSseStore.setState({ connect })
    const second = openMockInSseTab({
      serverId: 's1',
      name: 'A',
      url: 'http://127.0.0.1:3200/a',
      method: 'GET',
      path: '/a',
    })
    expect(second).not.toBe(first)
    expect(useSseStore.getState()._currentTabId).toBe(second)
    expect(useSseStore.getState().url).toBe('http://127.0.0.1:3200/a')
    expect(connect).toHaveBeenCalledTimes(1)
  })

  it('focusing a tab that is already connected does not reconnect it', () => {
    const id = openMockInSseTab({
      serverId: 's1',
      name: 'A',
      url: 'http://127.0.0.1:3200/a',
      method: 'GET',
      path: '/a',
    })
    useSseStore.setState({ connectionState: 'connected' })
    openMockInSseTab({ serverId: 's1', name: 'B', url: 'http://x/b', method: 'GET', path: '/b' })
    const connect = vi.fn(async () => {})
    useSseStore.setState({ connect })
    expect(
      openMockInSseTab({ serverId: 's1', name: 'A', url: 'http://x/a', method: 'GET', path: '/a' }),
    ).toBe(id)
    expect(useSseStore.getState().connectionState).toBe('connected')
    expect(connect).not.toHaveBeenCalled()
  })
})

describe('startAndOpenMockInSseTab', () => {
  const target = {
    serverId: 's1',
    name: 'Ticker SSE',
    url: 'http://127.0.0.1:3200/events',
    method: 'GET' as const,
    path: '/events',
  }

  it('not running + start fails → toast, no tab', async () => {
    const start = vi.fn(async () => 'Port 3200 is already in use')
    const id = await startAndOpenMockInSseTab({ ...target, running: false, start })
    expect(id).toBeNull()
    expect(start).toHaveBeenCalledTimes(1)
    expect(toast.error).toHaveBeenCalledWith('Port 3200 is already in use')
    expect(useTabsStore.getState().tabs).toHaveLength(0)
  })

  it('not running + start succeeds → the tab opens', async () => {
    const start = vi.fn(async () => null)
    const id = await startAndOpenMockInSseTab({ ...target, running: false, start })
    expect(id).toBeTruthy()
    expect(useTabsStore.getState().tabs[0]).toMatchObject({ protocol: 'sse', isDirty: false })
  })

  it('running → opens without starting', async () => {
    const start = vi.fn(async () => null)
    await startAndOpenMockInSseTab({ ...target, running: true, start })
    expect(start).not.toHaveBeenCalled()
    expect(useTabsStore.getState().tabs).toHaveLength(1)
  })
})

describe('openMockInAiChatTab (§D.3.5)', () => {
  const target = {
    serverId: 'ai-1',
    name: 'Chat API',
    url: 'http://127.0.0.1:3300/v1/chat/completions',
  }

  it('opens an AI Chat tab on Custom with the chat URL and mock-model, active and not dirty', async () => {
    const id = openMockInAiChatTab(target)
    await settle()
    const { tabs, activeTabId } = useTabsStore.getState()
    expect(activeTabId).toBe(id)
    expect(tabs.find((t) => t.id === id)).toMatchObject({
      protocol: 'ai',
      name: 'Chat API · client',
      isDirty: false,
    })
    const ai = useAiChatStore.getState()
    expect(ai._currentTabId).toBe(id)
    expect(ai.provider).toBe('custom')
    expect(ai.customUrl).toBe('http://127.0.0.1:3300/v1/chat/completions')
    expect(ai.model).toBe('mock-model')
    expect(openMockInAiChatTab({ ...target, serverId: 'ai-2', model: 'error-429' })).toBeTruthy()
    expect(useAiChatStore.getState().model).toBe('error-429')
  })

  it('PM review #20: a second click focuses the same AI Chat tab and leaves its settings alone', async () => {
    const id = openMockInAiChatTab(target)
    useAiChatStore.getState().setModel('error-stream')
    const again = openMockInAiChatTab(target)
    expect(again).toBe(id)
    expect(useTabsStore.getState().tabs.filter((t) => t.protocol === 'ai')).toHaveLength(1)
    expect(useAiChatStore.getState().model).toBe('error-stream')
    // The Anthropic button of the same server is its own tab.
    const anthropic = openMockInAiChatTab({
      ...target,
      url: 'http://127.0.0.1:3300/v1/messages',
      provider: 'anthropic',
    })
    expect(anthropic).not.toBe(id)
    await settle()
  })

  it('the saved OpenAI key is neither loaded nor kept: the key field is empty', async () => {
    // A session where the OpenAI key is already live in another tab.
    useAiChatStore.getState().switchToTab('other')
    await settle()
    expect(useAiChatStore.getState().apiKey).toBe('sk-real-openai')

    openMockInAiChatTab(target)
    expect(useAiChatStore.getState().apiKey).toBe('')
    await settle()
    expect(useAiChatStore.getState().apiKey).toBe('')
    // Issue #222: a tab opened from a mock never asks main for a saved key.
    expect(useAiChatStore.getState().savedKeyDisabled).toBe(true)
    expect(aiChatApi.getKey).not.toHaveBeenCalledWith('custom:http://127.0.0.1:3300')
  })

  it('a key carried in memory to the OpenAI origin does not hop to the mock', async () => {
    // Another tab: Custom with a blank URL, a key typed, then the OpenAI URL
    // typed — the key follows it in memory (`canCarryAiKey` from the blank
    // scope). That is the scope a fresh tab passes through when Custom is
    // picked before the URL is set.
    useAiChatStore.getState().switchToTab('other')
    useAiChatStore.getState().setCustomUrl('')
    useAiChatStore.getState().setProvider('custom')
    await settle()
    useAiChatStore.getState().setApiKey('sk-carried')
    useAiChatStore.getState().setCustomUrl('https://api.openai.com/v1/chat/completions')
    await settle()
    expect(useAiChatStore.getState().apiKey).toBe('sk-carried')

    openMockInAiChatTab(target)
    await settle()
    expect(useAiChatStore.getState().customUrl).toBe(target.url)
    expect(useAiChatStore.getState().apiKey).toBe('')
  })
})

describe('startAndOpenMockInAiChatTab', () => {
  const target = {
    serverId: 'ai-1',
    name: 'Chat API',
    url: 'http://127.0.0.1:3300/v1/chat/completions',
  }

  it('not running + start fails → toast, no tab', async () => {
    const start = vi.fn(async () => 'Port 3300 is already in use')
    const id = await startAndOpenMockInAiChatTab({ ...target, running: false, start })
    expect(id).toBeNull()
    expect(toast.error).toHaveBeenCalledWith('Port 3300 is already in use')
    expect(useTabsStore.getState().tabs).toHaveLength(0)
  })

  it('not running + start succeeds → the AI tab opens; running → no start', async () => {
    const start = vi.fn(async () => null)
    expect(await startAndOpenMockInAiChatTab({ ...target, running: false, start })).toBeTruthy()
    expect(useTabsStore.getState().tabs[0]).toMatchObject({ protocol: 'ai', isDirty: false })
    await startAndOpenMockInAiChatTab({ ...target, running: true, start })
    expect(start).toHaveBeenCalledTimes(1)
  })
})

describe('target endpoint and method rules', () => {
  it('AI: the first exact POST / ANY …/chat/completions, else the first exact POST that is not /messages', () => {
    const eps = [
      httpEndpoint({ id: 'm', method: 'GET', path: '/v1/models' }),
      httpEndpoint({ id: 'a', method: 'POST', path: '/v1/messages' }),
      httpEndpoint({ id: 'p', method: 'POST', path: '/v2/chat/completions', pathMode: 'param' }),
      httpEndpoint({ id: 'x', method: 'POST', path: '/v1/answer' }),
      httpEndpoint({ id: 'c', method: 'ANY', path: '/v1/chat/completions' }),
    ]
    expect(chatTargetEndpoint(eps)?.id).toBe('c')
    expect(chatTargetEndpoint(eps.slice(0, 4))?.id).toBe('x')
    // An Anthropic-only server: the Custom (OpenAI-format) tab would read an
    // Anthropic stream as an empty answer — no one-click target.
    expect(chatTargetEndpoint(eps.slice(0, 3))).toBeNull()
  })

  it('the header targets the first exact GET / ANY endpoint', () => {
    const eps = [
      httpEndpoint({ id: 'a', method: 'POST', path: '/x' }),
      httpEndpoint({ id: 'b', method: 'GET', path: '/users/:id', pathMode: 'param' }),
      httpEndpoint({ id: 'c', method: 'ANY', path: '/stream' }),
      httpEndpoint({ id: 'd', method: 'GET', path: '/events' }),
    ]
    expect(streamTargetEndpoint(eps)?.id).toBe('c')
    expect(streamTargetEndpoint([eps[0], eps[1]])).toBeNull()
  })

  it('ANY → GET; methods the SSE tab cannot send have no mapping', () => {
    expect(sseMethodFor('ANY')).toBe('GET')
    expect(sseMethodFor('PATCH')).toBe('PATCH')
    expect(sseMethodFor('HEAD')).toBeNull()
    expect(sseMethodFor('QUERY')).toBeNull()
  })

  it('the URL reaches a wildcard bind through loopback and keeps the base path', () => {
    const server = httpServer({ host: '0.0.0.0', port: 3200, basePath: 'api' })
    expect(mockEndpointUrl(server, '/events')).toBe('http://127.0.0.1:3200/api/events')
  })
})
