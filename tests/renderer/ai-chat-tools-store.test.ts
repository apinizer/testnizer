/**
 * Issues #180 / #198 / #199 — the AI Chat store's new paths:
 *  - Send carries the enabled MCP servers (connections built by the shared
 *    MCP call source, `{{var}}` resolved), never a disabled one, and no
 *    `tools` at all when none is enabled (MST-153);
 *  - stream events fold into the turn (tool parts, per-call metrics);
 *  - a finished turn is stored in the tab's conversation (created once, then
 *    appended), owner = the saved row or `tab:<id>`;
 *  - "Run tools without asking" and literal credentials are never saved;
 *    the conversation never goes into the localStorage snapshot;
 *  - closing a tab cancels its Send and drops an unsaved tab's conversations.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  send: vi.fn(async () => ({ success: true, data: { messageId: 'm1' } })),
  cancel: vi.fn(async () => ({ success: true, data: { cancelled: true } })),
  approveTool: vi.fn(async () => ({ success: true, data: { applied: true } })),
  resolveStdioTrust: vi.fn(async () => ({ success: true, data: { applied: true } })),
  endpointGet: vi.fn(),
  conv: {
    list: vi.fn(async () => ({ success: true, data: [] })),
    create: vi.fn(async (input: { name: string }) => ({
      success: true,
      data: { id: 'conv-1', name: input.name, turns: [] },
    })),
    append: vi.fn(async () => ({
      success: true,
      data: { id: 'conv-1', updatedAt: 1, turnCount: 4 },
    })),
    load: vi.fn(),
    rename: vi.fn(async () => ({ success: true, data: true })),
    remove: vi.fn(async () => ({ success: true, data: true })),
    rehome: vi.fn(async () => ({ success: true, data: 1 })),
    dropTab: vi.fn(async () => ({ success: true, data: 0 })),
  },
}))

vi.hoisted(() => {
  const g = globalThis as unknown as { window: { api?: unknown } }
  g.window.api = {
    aiChat: {
      send: api.send,
      cancel: api.cancel,
      approveTool: api.approveTool,
      resolveStdioTrust: api.resolveStdioTrust,
      onChunk: () => () => {},
      onDone: () => () => {},
      onError: () => () => {},
      onCancelled: () => () => {},
      onEvent: () => () => {},
      conversations: api.conv,
    },
    endpoint: { get: api.endpointGet },
  }
})

import {
  useAiChatStore,
  savedAiConfigOf,
  sanitizeAiTabState,
  restoreAiConfig,
} from '../../src/renderer/stores/ai-chat.store'
import {
  ensureAiConversationsLoaded,
  flushAiConversationWrites,
  rehomeAiConversations,
  renameAiConversation,
} from '../../src/renderer/stores/ai-chat-conversations'
import { answerToolApproval } from '../../src/renderer/stores/ai-chat-tools'
import { useEnvironmentStore } from '../../src/renderer/stores/environment.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import type { AiToolServerConfig } from '../../src/renderer/lib/ai-chat-tools-config'
import type { AiToolCallPart } from '../../src/shared/ai-chat-types'

const adhoc = (patch: Partial<AiToolServerConfig> = {}): AiToolServerConfig => ({
  id: 'srv-a',
  source: 'adhoc',
  name: 'Weather',
  enabled: true,
  transport: 'http',
  url: '{{mcpBase}}/mcp',
  headers: [{ id: 'h', key: 'X-Tenant', value: '{{tenant}}', enabled: true }],
  envVars: [],
  disabledTools: ['delete'],
  ...patch,
})

function reset(extra: Record<string, unknown> = {}): void {
  useTabsStore.setState({
    tabs: [{ id: 'tab-1', name: 'AI', protocol: 'ai', isDirty: false, isLoading: false }],
    activeTabId: 'tab-1',
  } as never)
  useAiChatStore.setState({
    provider: 'openai',
    customUrl: 'https://api.openai.com/v1/chat/completions',
    apiKey: '',
    model: 'gpt-5',
    systemPrompt: '',
    customHeaders: [],
    messages: [],
    streaming: false,
    pendingResponseId: null,
    pendingMessageId: null,
    errorMessage: null,
    toolServers: [],
    toolCatalog: {},
    autoApproveTools: false,
    allowedTools: [],
    conversationId: null,
    conversationName: null,
    conversations: [],
    conversationLoaded: true,
    _tabStates: new Map(),
    _currentTabId: 'tab-1',
    ...extra,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  useEnvironmentStore.setState({
    ...useEnvironmentStore.getState(),
    getActiveVariables: () => ({ mcpBase: 'http://127.0.0.1:9', tenant: 'acme' }),
  } as never)
  reset()
})

const lastPayload = (): Record<string, unknown> =>
  (api.send.mock.calls.at(-1) as unknown as [Record<string, unknown>])[0]

describe('Send — tools payload (#180)', () => {
  it('no enabled server → no `tools` key at all (MST-153)', async () => {
    reset({ toolServers: [adhoc({ enabled: false })] })
    await useAiChatStore.getState().sendPrompt('hello')
    expect('tools' in lastPayload()).toBe(false)
    expect(lastPayload().prompt).toBe('hello')
    expect(lastPayload().history).toEqual([])
  })

  it('an enabled ad-hoc server goes out resolved through the shared builder', async () => {
    reset({ toolServers: [adhoc()], allowedTools: ['srv-a::get'] })
    await useAiChatStore.getState().sendPrompt('hi')
    const tools = lastPayload().tools as Record<string, unknown>
    expect(tools).toMatchObject({ autoApprove: false, allowedTools: ['srv-a::get'] })
    expect(tools.servers).toEqual([
      {
        id: 'srv-a',
        name: 'Weather',
        connect: {
          transport: 'http',
          url: 'http://127.0.0.1:9/mcp',
          protocol: 'auto',
          headers: { 'X-Tenant': 'acme' },
        },
        disabledTools: ['delete'],
        timeoutMs: 120_000,
      },
    ])
  })

  it('a picked saved MCP request is read from its row; OAuth is flagged; a missing row becomes a notice', async () => {
    api.endpointGet.mockResolvedValueOnce({
      success: true,
      data: {
        name: 'Saved MCP',
        path: '',
        request_schema: JSON.stringify({
          timeout: 5000,
          metadata: {
            mcp: {
              transport: 'http',
              url: '{{mcpBase}}/saved',
              customHeaders: [{ key: 'Authorization', value: 'Bearer {{tenant}}', enabled: true }],
              auth: { type: 'oauth2' },
              protocol: 'auto',
            },
          },
        }),
      },
    })
    api.endpointGet.mockResolvedValueOnce({ success: false })
    reset({
      toolServers: [
        {
          id: 's1',
          source: 'saved',
          name: 'x',
          enabled: true,
          requestId: 'ep1',
          requestKind: 'endpoint',
          disabledTools: [],
        },
        {
          id: 's2',
          source: 'saved',
          name: 'Gone',
          enabled: true,
          requestId: 'ep2',
          requestKind: 'endpoint',
          disabledTools: [],
        },
      ],
    })
    await useAiChatStore.getState().sendPrompt('hi')
    const servers = (lastPayload().tools as { servers: Array<Record<string, unknown>> }).servers
    expect(servers).toHaveLength(1)
    expect(servers[0]).toMatchObject({
      id: 's1',
      name: 'Saved MCP',
      oauth: true,
      timeoutMs: 5000,
      connect: { url: 'http://127.0.0.1:9/saved', headers: { Authorization: 'Bearer acme' } },
    })
    const turn = useAiChatStore.getState().messages.at(-1)
    expect(turn?.role === 'assistant' && turn.parts?.[0]).toMatchObject({
      type: 'notice',
      kind: 'server-error',
      server: 'Gone',
    })
  })

  it('earlier turns go as history (main replays them as text)', async () => {
    reset({
      messages: [
        { id: 'u0', role: 'user', content: 'first', timestamp: 1 },
        {
          id: 'a0',
          role: 'assistant',
          content: 'ans',
          timestamp: 2,
          parts: [{ type: 'text', text: 'ans' }],
        },
      ],
    })
    await useAiChatStore.getState().sendPrompt('second')
    expect((lastPayload().history as unknown[]).length).toBe(2)
  })
})

describe('stream events → turn → conversation (#180, #198, #199)', () => {
  it('folds parts and metrics, then stores the turn: create once, append after', async () => {
    await useAiChatStore.getState().sendPrompt('weather?')
    const s = useAiChatStore.getState()
    const call: AiToolCallPart = {
      type: 'tool_call',
      id: 'c1',
      serverId: 'srv-a',
      server: 'Weather',
      tool: 'get',
      argsJson: '{}',
      status: 'pending-approval',
    }
    s._onPart('m1', call)
    s._onPart('m1', { ...call, status: 'done' })
    s._onPart('m1', { type: 'tool_result', callId: 'c1', content: 'sunny', isError: false })
    s._onChunk('m1', 'It is sunny.')
    s._onCall('m1', {
      status: 200,
      ttfbMs: 50,
      durationMs: 300,
      usageReported: true,
      inputTokens: 10,
      outputTokens: 4,
    })
    s._onCall('m1', { status: 200, ttfbMs: 40, durationMs: 200, usageReported: false })
    s._onDone('m1')
    const turn = useAiChatStore.getState().messages.at(-1)
    if (turn?.role !== 'assistant') throw new Error('no assistant turn')
    expect(turn.parts?.map((p) => p.type)).toEqual(['tool_call', 'tool_result', 'text'])
    expect(turn.content).toBe('It is sunny.')
    // Issue #198: one call reported, one did not → the reported sum, partial.
    expect(turn.metrics).toMatchObject({
      durationMs: 500,
      ttfbMs: 50,
      usageReported: true,
      usagePartial: true,
      totalTokens: 14,
    })

    await flushAiConversationWrites()
    expect(api.conv.create).toHaveBeenCalledTimes(1)
    const created = (api.conv.create.mock.calls[0] as unknown as [Record<string, unknown>])[0]
    expect(created).toMatchObject({ ownerId: 'tab:tab-1', name: 'weather?' })
    expect((created.turns as unknown[]).length).toBe(2)
    expect(useAiChatStore.getState().conversationId).toBe('conv-1')

    api.send.mockResolvedValueOnce({ success: true, data: { messageId: 'm2' } })
    await useAiChatStore.getState().sendPrompt('and tomorrow?')
    useAiChatStore.getState()._onChunk('m2', 'rain')
    useAiChatStore.getState()._onDone('m2')
    await flushAiConversationWrites()
    expect(api.conv.create).toHaveBeenCalledTimes(1)
    expect(api.conv.append).toHaveBeenCalledWith('conv-1', expect.any(Array))
  })

  it('a saved tab stores under its row id', async () => {
    useTabsStore.setState({
      tabs: [
        {
          id: 'tab-1',
          name: 'AI',
          protocol: 'ai',
          savedRequestId: 'sr-9',
          isDirty: false,
          isLoading: false,
        },
      ],
      activeTabId: 'tab-1',
    } as never)
    await useAiChatStore.getState().sendPrompt('x')
    useAiChatStore.getState()._onDone('m1')
    await flushAiConversationWrites()
    expect((api.conv.create.mock.calls[0] as unknown as [Record<string, unknown>])[0].ownerId).toBe(
      'sr-9',
    )
  })
})

describe('issue #199 — the conversation name never holds a secret value', () => {
  const SECRET = 'sk-live-SECRET-9d41c7'
  const stored = (): string => localStorage.getItem('testnizer-ai-chat') ?? ''

  it('the default name is the prompt as typed; DB name and snapshot never get the value', async () => {
    useEnvironmentStore.setState({
      ...useEnvironmentStore.getState(),
      getActiveVariables: () => ({ secretVar: SECRET }),
    } as never)
    await useAiChatStore.getState().sendPrompt('echo {{secretVar}}')
    // The model still gets the resolved prompt.
    expect(lastPayload().prompt).toBe(`echo ${SECRET}`)
    useAiChatStore.getState()._onChunk('m1', 'ok')
    useAiChatStore.getState()._onDone('m1')
    await flushAiConversationWrites()

    const created = (
      api.conv.create.mock.calls[0] as unknown as [{ name: string; turns: unknown[] }]
    )[0]
    expect(created.name).toBe('echo {{secretVar}}')
    expect(created.turns[0]).toMatchObject({
      content: `echo ${SECRET}`,
      template: 'echo {{secretVar}}',
    })
    expect(useAiChatStore.getState().conversationName).toBe('echo {{secretVar}}')

    // localStorage `testnizer-ai-chat` (conversationName, conversations[].name)
    useAiChatStore.setState({
      conversations: [
        { id: 'conv-1', name: 'echo {{secretVar}}', turnCount: 2, createdAt: 1, updatedAt: 1 },
      ],
    })
    expect(stored()).not.toBe('')
    expect(stored()).not.toContain(SECRET)
  })

  it('the snapshot never carries a name, even one that leaked before', () => {
    reset({
      conversationId: 'conv-1',
      conversationName: `echo ${SECRET}`,
      conversations: [
        { id: 'conv-1', name: `echo ${SECRET}`, turnCount: 2, createdAt: 1, updatedAt: 1 },
      ],
    })
    const snap = sanitizeAiTabState({ ...useAiChatStore.getState() })
    expect(JSON.stringify(snap)).not.toContain(SECRET)
    // The id stays: the name comes back from the database (scrubbed by main).
    expect(snap.conversationId).toBe('conv-1')
    expect(stored()).not.toContain(SECRET)
  })

  it('a rename shows the name main stored, not the typed one', async () => {
    reset({ conversationId: 'conv-1', conversationName: 'old' })
    api.conv.list.mockResolvedValueOnce({
      success: true,
      data: [{ id: 'conv-1', name: 'renamed ••••••', turnCount: 2, createdAt: 1, updatedAt: 2 }],
    } as never)
    await renameAiConversation('conv-1', `renamed ${SECRET}`)
    expect(useAiChatStore.getState().conversationName).toBe('renamed ••••••')
    expect(stored()).not.toContain(SECRET)
  })
})

describe('what is saved / snapshotted', () => {
  it('saved config: tool servers without literal secrets, never autoApprove', () => {
    reset({
      autoApproveTools: true,
      toolServers: [
        adhoc({
          headers: [
            { id: '1', key: 'Authorization', value: 'Bearer LITERAL-SECRET', enabled: true },
            { id: '2', key: 'X-Api-Key', value: '{{key}}', enabled: true },
          ],
        }),
      ],
    })
    const cfg = savedAiConfigOf(useAiChatStore.getState())
    const json = JSON.stringify(cfg)
    expect(json).not.toContain('LITERAL-SECRET')
    expect(json).toContain('{{key}}')
    expect(json).not.toContain('autoApprove')
    expect(cfg.toolServers[0].disabledTools).toEqual(['delete'])

    restoreAiConfig(JSON.parse(json))
    expect(useAiChatStore.getState().toolServers[0]).toMatchObject({
      id: 'srv-a',
      url: '{{mcpBase}}/mcp',
    })
  })

  it('the localStorage snapshot holds no conversation and no literal server secret', () => {
    reset({
      messages: [{ id: 'u', role: 'user', content: 'CANARY-local', timestamp: 1 }],
      toolServers: [
        adhoc({
          envVars: [{ id: 'e', key: 'API_TOKEN', value: 'tok-LITERAL', enabled: true }],
          transport: 'stdio',
        }),
      ],
    })
    const snap = sanitizeAiTabState({ ...useAiChatStore.getState() })
    expect(snap.messages).toEqual([])
    expect(JSON.stringify(snap)).not.toContain('tok-LITERAL')
    expect(snap.conversationLoaded).toBe(false)
  })
})

describe('approval + tab close', () => {
  it('"Allow this tool for this conversation" records the grant and answers main', async () => {
    reset({ pendingMessageId: 'm1', streaming: true })
    await answerToolApproval(
      {
        type: 'tool_call',
        id: 'c1',
        serverId: 'srv-a',
        server: 'W',
        tool: 'get',
        argsJson: '{}',
        status: 'pending-approval',
      },
      'conversation',
    )
    expect(api.approveTool).toHaveBeenCalledWith('m1', 'c1', 'conversation')
    expect(useAiChatStore.getState().allowedTools).toEqual(['srv-a::get'])
  })

  it('closing the tab cancels its Send and drops an unsaved tab conversation', async () => {
    reset({ pendingMessageId: 'm7', streaming: true })
    useAiChatStore.getState().removeTabState('tab-1')
    expect(api.cancel).toHaveBeenCalledWith('m7')
    await flushAiConversationWrites()
    expect(api.conv.dropTab).toHaveBeenCalledWith('tab:tab-1')
  })
})

describe('first Save of an unsaved tab (#199)', () => {
  it('rehomes tab:<id> conversations to the new row and reloads the list', async () => {
    await rehomeAiConversations('tab-1', 'sr-new')
    expect(api.conv.rehome).toHaveBeenCalledWith('tab:tab-1', 'sr-new')
    expect(api.conv.list).toHaveBeenCalledWith('sr-new')
  })
})

describe('upgrade: a tab restored from an older snapshot (#199)', () => {
  it('turns on screen without a conversation are stored as one on first open', async () => {
    reset({
      conversationLoaded: false,
      messages: [
        { id: 'u0', role: 'user', content: 'old question', timestamp: 1 },
        { id: 'a0', role: 'assistant', content: 'old answer', timestamp: 2 },
      ],
    })
    await ensureAiConversationsLoaded()
    await flushAiConversationWrites()
    const input = (api.conv.create.mock.calls[0] as unknown as [Record<string, unknown>])[0]
    expect(input).toMatchObject({ ownerId: 'tab:tab-1', name: 'old question' })
    expect((input.turns as unknown[]).length).toBe(2)
    expect(useAiChatStore.getState().conversationId).toBe('conv-1')
  })

  it('the first answer after an upgrade stores the earlier turns too', async () => {
    reset({
      messages: [
        { id: 'u0', role: 'user', content: 'old q', timestamp: 1 },
        { id: 'a0', role: 'assistant', content: 'old a', timestamp: 2 },
      ],
    })
    await useAiChatStore.getState().sendPrompt('new q')
    useAiChatStore.getState()._onDone('m1')
    await flushAiConversationWrites()
    const input = (api.conv.create.mock.calls[0] as unknown as [Record<string, unknown>])[0]
    expect((input.turns as Array<{ content: string }>).map((t) => t.content)).toEqual([
      'old q',
      'old a',
      'new q',
      '',
    ])
  })
})

describe('a saved server whose MCP request was not copied (Duplicate, #180)', () => {
  it('survives restore, is never sent, and shows a notice on the turn', async () => {
    restoreAiConfig({
      provider: 'openai',
      toolServers: [
        {
          id: 'gone',
          source: 'saved',
          name: 'Ghost',
          enabled: true,
          missing: true,
          requestKind: 'endpoint',
          disabledTools: [],
        },
      ],
    })
    expect(useAiChatStore.getState().toolServers).toEqual([
      expect.objectContaining({ id: 'gone', missing: true }),
    ])
    await useAiChatStore.getState().sendPrompt('hi')
    expect('tools' in lastPayload()).toBe(false)
    expect(api.endpointGet).not.toHaveBeenCalled()
    const turn = useAiChatStore.getState().messages.at(-1)
    expect(turn?.role === 'assistant' && turn.parts?.[0]).toMatchObject({
      kind: 'server-error',
      server: 'Ghost',
    })
  })
})
