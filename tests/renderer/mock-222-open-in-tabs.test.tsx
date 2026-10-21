/**
 * Issue #222 items 1 and 3 — the "Open in … tab" header buttons of mock servers.
 *
 *  (1) Mock MCP: a stopped server's button reads "Start & open in MCP tab",
 *      starts the server and opens the MCP tab on the URL the start reported;
 *      a failed start opens nothing. Before: a toast, then a tab against the
 *      dead port anyway.
 *  (3) AI: "Open in AI Chat (Anthropic)" opens the tab on the Anthropic
 *      provider against the mock's `…/v1/messages`. The Anthropic key scope is
 *      the provider itself, whatever the URL, so a plain `setProvider` would
 *      load the user's saved Anthropic key and send it to the mock as
 *      `x-api-key`. A tab opened from a mock is `savedKeyDisabled`: the saved
 *      key is never loaded (both AI buttons, one rule), a key typed into the
 *      tab is used for that tab only and never persisted, and the mark
 *      survives the snapshot / a saved request.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import React from 'react'
// Must come first: installs window.api.mock before mock.store captures it at import.
import { httpBridge, httpEndpoint, httpServer, resetHttpBridge } from './mock-http-bridge-stub'
import { installBridge, runningState, sampleServer, type BridgeStub } from './mock-mcp-bridge-stub'

vi.mock('../../src/renderer/lib/toast', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}))

import { toast } from '../../src/renderer/lib/toast'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useMcpStore } from '../../src/renderer/stores/mcp.store'
import { useMockStore } from '../../src/renderer/stores/mock.store'
import { useMockMcpStore, stoppedState } from '../../src/renderer/stores/mock-mcp.store'
import {
  flushAiKeyWrites,
  readAiTab,
  resetAiKeySessionForTests,
  restoreAiConfig,
  sanitizeAiTabState,
  savedAiConfigOf,
  useAiChatStore,
} from '../../src/renderer/stores/ai-chat.store'
import {
  anthropicTargetEndpoint,
  chatTargetEndpoint,
  openMockInAiChatTab,
} from '../../src/renderer/components/mock/mock-open-in-tab'
import MockMcpEditorHeader from '../../src/renderer/components/mock-mcp/MockMcpEditorHeader'
import {
  MockAiChatAnthropicButton,
  MockAiChatHeaderButton,
} from '../../src/renderer/components/mock/MockOpenInAiChat'
import AiChatApiKeyField from '../../src/renderer/components/protocols/ai-chat/AiChatApiKeyField'

/** Keys main's encrypted store would hand out: the user's real provider keys. */
const SAVED_KEYS: Record<string, string> = {
  openai: 'sk-real-openai',
  anthropic: 'sk-ant-real',
}
const aiChatApi = {
  send: vi.fn(async (_p: Record<string, unknown>) => ({
    success: true,
    data: { messageId: 'msg-1' },
  })),
  cancel: vi.fn(async () => ({ success: true })),
  getKey: vi.fn(async (scope: string) => ({
    success: true,
    data: { key: SAVED_KEYS[scope] ?? '', encryptionAvailable: true },
  })),
  setKey: vi.fn(async () => ({
    success: true,
    data: { persisted: true, encryptionAvailable: true },
  })),
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0))
}

const ANTHROPIC_URL = 'http://127.0.0.1:3300/v1/messages'

let stub: BridgeStub

beforeEach(() => {
  stub = installBridge([sampleServer({ id: 'm1', name: 'Echo MCP', port: 3100 })])
  ;(window as unknown as { api: Record<string, unknown> }).api.aiChat = aiChatApi
  aiChatApi.send.mockClear()
  aiChatApi.setKey.mockClear()
  useTabsStore.setState({ tabs: [], activeTabId: null })
  useMockMcpStore.setState({ stateByServer: {} })
  vi.mocked(toast.error).mockClear()
  vi.mocked(toast.info).mockClear()
  resetAiKeySessionForTests()
  resetHttpBridge([httpServer({ id: 'ai-1', kind: 'ai', port: 3300, name: 'Chat API' })])
})

afterEach(() => cleanup())

// ─── (1) Mock MCP: Start & open in MCP tab ─────────────────────────

describe('issue #222 (1) — Mock MCP "Start & open in MCP tab"', () => {
  const server = sampleServer({ id: 'm1', name: 'Echo MCP', port: 3100 })
  const header = (): React.ReactElement => (
    <MockMcpEditorHeader
      server={server}
      dirty={false}
      saving={false}
      onSave={() => {}}
      onDiscard={() => {}}
    />
  )

  it('stopped → the label says Start & open; a click starts, then opens on the live URL', async () => {
    useMockMcpStore.setState({ stateByServer: { m1: stoppedState('m1') } })
    vi.mocked(stub.bridge.server.start).mockResolvedValueOnce({
      success: true,
      data: runningState('m1', 4610),
    })
    render(header())
    const btn = screen.getByTestId('mock-mcp-open-in-mcp')
    expect(btn).toHaveTextContent('Start & open in MCP tab')
    fireEvent.click(btn)
    await waitFor(() => expect(useTabsStore.getState().tabs.length).toBe(1))
    expect(stub.bridge.server.start).toHaveBeenCalledWith('m1')
    const tab = useTabsStore.getState().tabs[0]
    expect(tab.protocol).toBe('mcp')
    // The URL the start reported, not the pre-start guess.
    expect(useMcpStore.getState().url).toBe('http://127.0.0.1:4610/mcp')
    expect(toast.info).not.toHaveBeenCalled()
  })

  it('stopped + start fails → error toast, NO tab', async () => {
    useMockMcpStore.setState({ stateByServer: { m1: stoppedState('m1') } })
    vi.mocked(stub.bridge.server.start).mockResolvedValueOnce({
      success: false,
      error: 'EADDRINUSE',
    } as never)
    render(header())
    fireEvent.click(screen.getByTestId('mock-mcp-open-in-mcp'))
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(useTabsStore.getState().tabs).toHaveLength(0)
  })

  it('PM review #20: connects the new tab, titles it "<name> · client", and a second click focuses it', () => {
    useMockMcpStore.setState({ stateByServer: { m1: runningState('m1', 3100) } })
    const original = useMcpStore.getState().connect
    const connect = vi.fn(async () => {})
    useMcpStore.setState({ connect, connectionState: 'disconnected' })
    try {
      render(header())
      fireEvent.click(screen.getByTestId('mock-mcp-open-in-mcp'))
      const [tab] = useTabsStore.getState().tabs
      expect(tab).toMatchObject({ protocol: 'mcp', name: 'Echo MCP · client' })
      expect(connect).toHaveBeenCalledTimes(1)
      expect(useMcpStore.getState()._currentTabId).toBe(tab.id)

      // Connected now; the user switches away and clicks Open again.
      useMcpStore.setState({ connectionState: 'connected' })
      useTabsStore.getState().openTab({ id: 'other', name: 'Other', protocol: 'http' })
      fireEvent.click(screen.getByTestId('mock-mcp-open-in-mcp'))
      expect(useTabsStore.getState().tabs.filter((t) => t.protocol === 'mcp')).toHaveLength(1)
      expect(useTabsStore.getState().activeTabId).toBe(tab.id)
      expect(connect).toHaveBeenCalledTimes(1)
    } finally {
      useMcpStore.setState({ connect: original })
    }
  })

  it('running → "Open in MCP tab", opens without starting', () => {
    useMockMcpStore.setState({ stateByServer: { m1: runningState('m1', 3100) } })
    render(header())
    const btn = screen.getByTestId('mock-mcp-open-in-mcp')
    expect(btn).toHaveTextContent('Open in MCP tab')
    fireEvent.click(btn)
    expect(stub.bridge.server.start).not.toHaveBeenCalled()
    expect(useTabsStore.getState().tabs).toHaveLength(1)
  })
})

// ─── (3) Open in AI Chat (Anthropic) ───────────────────────────────

describe('issue #222 (3) — anthropicTargetEndpoint', () => {
  it('the first exact POST / ANY …/messages; the OpenAI target never picks it', () => {
    const eps = [
      httpEndpoint({ id: 'a', method: 'GET', path: '/v1/models' }),
      httpEndpoint({ id: 'b', method: 'POST', path: '/v1/messages', pathMode: 'param' }),
      httpEndpoint({ id: 'c', method: 'POST', path: '/v1/chat/completions' }),
      httpEndpoint({ id: 'd', method: 'ANY', path: '/v1/messages' }),
    ]
    expect(anthropicTargetEndpoint(eps)?.id).toBe('d')
    expect(chatTargetEndpoint(eps)?.id).toBe('c')
    expect(anthropicTargetEndpoint(eps.slice(0, 3))).toBeNull()
  })
})

describe('issue #222 (3) — the AI Chat tab opened from a mock never carries a saved key', () => {
  async function anthropicTabElsewhere(): Promise<void> {
    // Another tab on the real Anthropic provider: the saved key is loaded there.
    useAiChatStore.getState().switchToTab('real')
    useAiChatStore.getState().setProvider('anthropic')
    await settle()
    expect(useAiChatStore.getState().apiKey).toBe('sk-ant-real')
  }

  it('Anthropic: provider anthropic, the mock URL, no key — and none is sent', async () => {
    await anthropicTabElsewhere()
    const id = openMockInAiChatTab({
      serverId: 'ai-1',
      name: 'Chat API',
      url: ANTHROPIC_URL,
      provider: 'anthropic',
    })
    let ai = useAiChatStore.getState()
    expect(ai._currentTabId).toBe(id)
    expect(ai.provider).toBe('anthropic')
    // setProvider replaces the URL with api.anthropic.com — set after it.
    expect(ai.customUrl).toBe(ANTHROPIC_URL)
    expect(ai.model).toBe('mock-model')
    expect(ai.savedKeyDisabled).toBe(true)
    expect(ai.apiKey).toBe('')
    await settle()
    ai = useAiChatStore.getState()
    expect(ai.apiKey).toBe('')

    await ai.sendPrompt('hi')
    const payload = aiChatApi.send.mock.calls.at(-1)?.[0] as Record<string, unknown>
    expect(payload).toMatchObject({ provider: 'anthropic', url: ANTHROPIC_URL, apiKey: '' })
    expect(useTabsStore.getState().tabs.find((t) => t.id === id)?.isDirty).toBe(false)
  })

  it('a key typed into the mock tab is used there only — never persisted, never over the saved key', async () => {
    await anthropicTabElsewhere()
    const id = openMockInAiChatTab({
      serverId: 'ai-1',
      name: 'Chat API',
      url: ANTHROPIC_URL,
      provider: 'anthropic',
    })
    useAiChatStore.getState().setApiKey('sk-typed-for-mock')
    await flushAiKeyWrites()
    expect(aiChatApi.setKey).not.toHaveBeenCalled()
    await useAiChatStore.getState().sendPrompt('hi')
    expect(aiChatApi.send.mock.calls.at(-1)?.[0]).toMatchObject({ apiKey: 'sk-typed-for-mock' })

    // The real tab still has the saved key; back on the mock tab the typed one.
    useAiChatStore.getState().switchToTab('real')
    await settle()
    expect(useAiChatStore.getState().apiKey).toBe('sk-ant-real')
    useAiChatStore.getState().switchToTab(id)
    await settle()
    expect(useAiChatStore.getState().apiKey).toBe('sk-typed-for-mock')

    // Pointed at another origin, the typed key does not follow.
    useAiChatStore.getState().setCustomUrl('http://127.0.0.1:9999/v1/messages')
    expect(useAiChatStore.getState().apiKey).toBe('')
  })

  it('"Use saved key" turns the mark off and loads the saved key', async () => {
    openMockInAiChatTab({
      serverId: 'ai-1',
      name: 'Chat API',
      url: ANTHROPIC_URL,
      provider: 'anthropic',
    })
    await settle()
    expect(useAiChatStore.getState().apiKey).toBe('')
    useAiChatStore.getState().setSavedKeyDisabled(false)
    await settle()
    expect(useAiChatStore.getState().apiKey).toBe('sk-ant-real')
  })

  it('the OpenAI-compatible button uses the same mark (one rule for both)', () => {
    openMockInAiChatTab({
      serverId: 'ai-1',
      name: 'Chat API',
      url: 'http://127.0.0.1:3300/v1/chat/completions',
    })
    const ai = useAiChatStore.getState()
    expect(ai.provider).toBe('custom')
    expect(ai.savedKeyDisabled).toBe(true)
  })

  it('the mark survives the snapshot and a saved request; a normal tab saves no mark', async () => {
    const id = openMockInAiChatTab({
      serverId: 'ai-1',
      name: 'Chat API',
      url: ANTHROPIC_URL,
      provider: 'anthropic',
    })
    const st = readAiTab(id)!
    expect(sanitizeAiTabState(st).savedKeyDisabled).toBe(true)
    const saved = savedAiConfigOf(st)
    expect(saved.savedKeyDisabled).toBe(true)
    useAiChatStore.getState().switchToTab('plain')
    expect(savedAiConfigOf(readAiTab('plain')!)).not.toHaveProperty('savedKeyDisabled')

    // Reopening the saved request: still no saved key.
    useAiChatStore.getState().switchToTab('reopened')
    restoreAiConfig(JSON.parse(JSON.stringify(saved)))
    await settle()
    const ai = useAiChatStore.getState()
    expect(ai.savedKeyDisabled).toBe(true)
    expect(ai.provider).toBe('anthropic')
    expect(ai.apiKey).toBe('')
  })
})

describe('issue #222 (3) — the Anthropic header button', () => {
  const server = httpServer({ id: 'ai-1', kind: 'ai', port: 3300, name: 'Chat API' })

  it('hidden without a …/messages endpoint', () => {
    useMockStore.setState({
      endpointsByServer: {
        'ai-1': [httpEndpoint({ serverId: 'ai-1', method: 'POST', path: '/v1/chat/completions' })],
      },
    })
    render(<MockAiChatAnthropicButton server={server} status="stopped" />)
    expect(screen.queryByTestId('mock-open-in-ai-chat-anthropic')).toBeNull()
  })

  it('stopped → "Start & open in AI Chat (Anthropic)": starts, then opens the Anthropic tab', async () => {
    useMockStore.setState({
      endpointsByServer: {
        'ai-1': [httpEndpoint({ serverId: 'ai-1', method: 'POST', path: '/v1/messages' })],
      },
    })
    render(<MockAiChatAnthropicButton server={server} status="stopped" />)
    const btn = screen.getByTestId('mock-open-in-ai-chat-anthropic')
    expect(btn).toHaveTextContent('Start & open in AI Chat (Anthropic)')
    fireEvent.click(btn)
    await waitFor(() => expect(useTabsStore.getState().tabs).toHaveLength(1))
    expect(httpBridge.server.start).toHaveBeenCalledWith('ai-1')
    const ai = useAiChatStore.getState()
    expect(ai.provider).toBe('anthropic')
    expect(ai.customUrl).toBe(ANTHROPIC_URL)
    expect(ai.savedKeyDisabled).toBe(true)
  })

  it('no endpoint at all: the OpenAI button stays, disabled with the reason', () => {
    useMockStore.setState({ endpointsByServer: { 'ai-1': [] } })
    render(<MockAiChatHeaderButton server={server} status="running" />)
    const open = screen.getByTestId('mock-open-in-ai-chat')
    expect(open).toBeDisabled()
    expect(open.getAttribute('title')).toBe('Add POST /v1/chat/completions first')
  })

  it('an Anthropic-only server shows no disabled OpenAI button next to it', () => {
    useMockStore.setState({
      endpointsByServer: {
        'ai-1': [httpEndpoint({ serverId: 'ai-1', method: 'POST', path: '/v1/messages' })],
      },
    })
    render(
      <>
        <MockAiChatHeaderButton server={server} status="running" />
        <MockAiChatAnthropicButton server={server} status="running" />
      </>,
    )
    expect(screen.queryByTestId('mock-open-in-ai-chat')).toBeNull()
    expect(screen.getByTestId('mock-open-in-ai-chat-anthropic')).toHaveTextContent(
      'Open in AI Chat (Anthropic)',
    )
  })
})

describe('issue #222 (3) — the key field says the saved key is not sent', () => {
  it('shows the note on a mock tab; "Use saved key" brings the saved key back', async () => {
    openMockInAiChatTab({
      serverId: 'ai-1',
      name: 'Chat API',
      url: ANTHROPIC_URL,
      provider: 'anthropic',
    })
    render(<AiChatApiKeyField />)
    expect(screen.getByTestId('ai-saved-key-disabled-note')).toHaveTextContent(
      /saved API key is not sent/,
    )
    fireEvent.click(screen.getByTestId('ai-use-saved-key'))
    await waitFor(() => expect(screen.getByTestId('ai-api-key')).toHaveValue('sk-ant-real'))
    expect(screen.queryByTestId('ai-saved-key-disabled-note')).toBeNull()
  })
})
