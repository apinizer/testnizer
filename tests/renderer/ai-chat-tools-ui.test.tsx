/**
 * Issues #180 / #198 / #199 — AI Chat UI: tool call card with the approval
 * card (Allow once / for this conversation / Deny), the stdio trust card
 * (command line + env NAMES, "Trust and connect"), the loop-cap note, the
 * per-message metrics row ("not reported", never 0), the conversation list
 * (switch / rename / delete) and the Tools tab's saved MCP request picker.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import React from 'react'

const api = vi.hoisted(() => ({
  approveTool: vi.fn(async () => ({ success: true, data: { applied: true } })),
  resolveStdioTrust: vi.fn(async () => ({ success: true, data: { applied: true } })),
  conv: {
    list: vi.fn(async () => ({
      success: true,
      data: [
        { id: 'c1', name: 'First chat', turnCount: 2, createdAt: 1, updatedAt: 2 },
        { id: 'c2', name: 'Second chat', turnCount: 2, createdAt: 1, updatedAt: 1 },
      ],
    })),
    load: vi.fn(async (id: string) => ({
      success: true,
      data: {
        id,
        name: id === 'c2' ? 'Second chat' : 'First chat',
        turns: [{ id: 'u', role: 'user', content: `content of ${id}`, timestamp: 1 }],
      },
    })),
    rename: vi.fn(async () => ({ success: true, data: true })),
    remove: vi.fn(async () => ({ success: true, data: true })),
    create: vi.fn(),
    append: vi.fn(),
    rehome: vi.fn(),
    dropTab: vi.fn(),
  },
}))
vi.hoisted(() => {
  const g = globalThis as unknown as { window: { api?: unknown } }
  g.window.api = {
    aiChat: {
      send: vi.fn(),
      cancel: vi.fn(),
      approveTool: api.approveTool,
      resolveStdioTrust: api.resolveStdioTrust,
      onChunk: () => () => {},
      onDone: () => () => {},
      onError: () => () => {},
      onCancelled: () => () => {},
      onEvent: () => () => {},
      conversations: api.conv,
    },
  }
})

import AiChatEditor from '../../src/renderer/components/protocols/AiChatEditor'
import { sumTurnMetrics } from '../../src/shared/ai-chat-turns'
import { useAiChatStore } from '../../src/renderer/stores/ai-chat.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import type { AiAssistantTurn } from '../../src/shared/ai-chat-types'

function seed(extra: Record<string, unknown> = {}): void {
  useTabsStore.setState({
    tabs: [
      {
        id: 'tab-1',
        name: 'AI',
        protocol: 'ai',
        savedRequestId: 'sr-1',
        isDirty: false,
        isLoading: false,
      },
    ],
    activeTabId: 'tab-1',
  } as never)
  useAiChatStore.setState({
    provider: 'openai',
    customUrl: 'https://api.openai.com/v1/chat/completions',
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

const liveTurn = (parts: AiAssistantTurn['parts']): AiAssistantTurn => ({
  id: 'a1',
  role: 'assistant',
  content: '',
  parts,
  timestamp: 1,
})

beforeEach(() => {
  vi.clearAllMocks()
  act(() => useUIStore.setState({ locale: 'en' }))
  seed()
})
afterEach(cleanup)

describe('tool call + approval card', () => {
  it('a pending call in the streaming turn shows the approval card; Deny answers main', () => {
    seed({
      streaming: true,
      pendingResponseId: 'a1',
      pendingMessageId: 'm1',
      messages: [
        { id: 'u1', role: 'user', content: 'q', timestamp: 1 },
        liveTurn([
          {
            type: 'tool_call',
            id: 'call1',
            serverId: 's',
            server: 'Weather',
            tool: 'get',
            argsJson: '{"city":"Ankara"}',
            status: 'pending-approval',
          },
        ]),
      ],
    })
    render(<AiChatEditor />)
    const card = screen.getByTestId('ai-tool-approval')
    expect(screen.getByTestId('ai-tool-args').textContent).toContain('"city": "Ankara"')
    fireEvent.click(within(card).getByTestId('ai-approve-deny'))
    expect(api.approveTool).toHaveBeenCalledWith('m1', 'call1', 'deny')
  })

  it('a finished call shows its result (collapsed until opened); no approval card', () => {
    seed({
      messages: [
        liveTurn([
          {
            type: 'tool_call',
            id: 'c',
            serverId: 's',
            server: 'W',
            tool: 'get',
            argsJson: '{}',
            status: 'error',
          },
          { type: 'tool_result', callId: 'c', content: 'boom', isError: true },
        ]),
      ],
    })
    render(<AiChatEditor />)
    expect(screen.queryByTestId('ai-tool-approval')).toBeNull()
    expect(screen.getByTestId('ai-tool-call-status').textContent).toBe('Error')
    fireEvent.click(screen.getByText('W › get'))
    expect(screen.getByTestId('ai-tool-result').textContent).toBe('boom')
  })

  it('stdio trust card: command + env names, Trust and connect answers main; loop-cap note', () => {
    seed({
      streaming: true,
      pendingResponseId: 'a1',
      pendingMessageId: 'm1',
      messages: [
        liveTurn([
          {
            type: 'notice',
            id: 'stdio:local',
            kind: 'stdio-untrusted',
            serverId: 'local',
            server: 'Local',
            commandLine: 'node server.js --api-key ***',
            envNames: ['API_TOKEN'],
            status: 'pending',
          },
          { type: 'notice', id: 'loop-cap', kind: 'loop-cap' },
        ]),
      ],
    })
    render(<AiChatEditor />)
    expect(screen.getByTestId('ai-stdio-command').textContent).toBe('node server.js --api-key ***')
    expect(screen.getByText(/API_TOKEN/)).toBeTruthy()
    fireEvent.click(screen.getByTestId('ai-stdio-trust'))
    expect(api.resolveStdioTrust).toHaveBeenCalledWith('m1', 'local', 'trust')
    expect(screen.getByTestId('ai-loop-cap-note')).toBeTruthy()
  })
})

describe('metrics row (#198)', () => {
  it('shows status, TTFB, total and tokens; "not reported" instead of 0', () => {
    seed({
      messages: [
        {
          ...liveTurn([{ type: 'text', text: 'hi' }]),
          metrics: {
            calls: [
              {
                status: 200,
                ttfbMs: 120,
                durationMs: 900,
                usageReported: true,
                inputTokens: 10,
                outputTokens: 5,
              },
            ],
            status: 200,
            ttfbMs: 120,
            durationMs: 900,
            usageReported: true,
            inputTokens: 10,
            outputTokens: 5,
            totalTokens: 15,
          },
        },
        {
          ...liveTurn([{ type: 'text', text: 'no usage' }]),
          id: 'a2',
          metrics: {
            calls: [{ status: 200, ttfbMs: null, durationMs: 10, usageReported: false }],
            status: 200,
            ttfbMs: null,
            durationMs: 10,
            usageReported: false,
          },
        },
      ],
    })
    render(<AiChatEditor />)
    const rows = screen.getAllByTestId('ai-metrics')
    expect(rows[0].textContent).toContain('200')
    expect(rows[0].textContent).toContain('120 ms')
    expect(screen.getAllByTestId('ai-metrics-tokens')[0].textContent).toBe('15 tokens')
    expect(screen.getAllByTestId('ai-metrics-tokens')[0].getAttribute('title')).toContain(
      'Input 10',
    )
    expect(screen.getAllByTestId('ai-metrics-tokens')[1].textContent).toBe('tokens: not reported')
    expect(rows[1].textContent).not.toMatch(/\b0 tokens/)
  })

  it('Turkish: "bildirilmedi"', () => {
    act(() => useUIStore.setState({ locale: 'tr' }))
    seed({
      messages: [
        {
          ...liveTurn([{ type: 'text', text: 'x' }]),
          metrics: { calls: [], status: 200, ttfbMs: null, durationMs: 0, usageReported: false },
        },
      ],
    })
    render(<AiChatEditor />)
    expect(screen.getByTestId('ai-metrics-tokens').textContent).toBe('token: bildirilmedi')
  })
})

describe('partial usage (#198)', () => {
  const partial = () =>
    sumTurnMetrics([
      {
        status: 200,
        ttfbMs: 100,
        durationMs: 400,
        usageReported: true,
        inputTokens: 10,
        outputTokens: 5,
      },
      { status: 200, ttfbMs: 80, durationMs: 300, usageReported: false },
      {
        status: 200,
        ttfbMs: 70,
        durationMs: 200,
        usageReported: true,
        inputTokens: 20,
        outputTokens: 3,
      },
    ])

  it('some calls reported → their sum with a visible "partial" marker; hover lists which', () => {
    seed({ messages: [{ ...liveTurn([{ type: 'text', text: 'hi' }]), metrics: partial() }] })
    render(<AiChatEditor />)
    const tokens = screen.getByTestId('ai-metrics-tokens')
    expect(tokens.textContent).toBe('38 tokens')
    const marker = screen.getByTestId('ai-metrics-partial')
    expect(marker.textContent).toBe('partial')
    const hover = marker.getAttribute('title') ?? ''
    expect(hover).toContain('Partial — usage reported by calls #1, #3 of 3')
    expect(tokens.getAttribute('title')).toContain('#1, #3')
    expect(screen.getByTestId('ai-metrics').textContent).not.toContain('not reported ·')
  })

  it('no call reported → "not reported", no partial marker', () => {
    seed({
      messages: [
        {
          ...liveTurn([{ type: 'text', text: 'hi' }]),
          metrics: sumTurnMetrics([
            { status: 200, ttfbMs: 1, durationMs: 1, usageReported: false },
            { status: 200, ttfbMs: 1, durationMs: 1, usageReported: false },
          ]),
        },
      ],
    })
    render(<AiChatEditor />)
    expect(screen.getByTestId('ai-metrics-tokens').textContent).toBe('tokens: not reported')
    expect(screen.queryByTestId('ai-metrics-partial')).toBeNull()
  })

  it('Turkish: "kısmi"', () => {
    act(() => useUIStore.setState({ locale: 'tr' }))
    seed({ messages: [{ ...liveTurn([{ type: 'text', text: 'x' }]), metrics: partial() }] })
    render(<AiChatEditor />)
    expect(screen.getByTestId('ai-metrics-tokens').textContent).toBe('38 token')
    expect(screen.getByTestId('ai-metrics-partial').textContent).toBe('kısmi')
    expect(screen.getByTestId('ai-metrics-partial').getAttribute('title')).toContain('#1, #3')
  })
})

describe('conversations (#199)', () => {
  it('loads the list on first open, switches, renames and deletes', async () => {
    seed({ conversationLoaded: false })
    render(<AiChatEditor />)
    await act(async () => {})
    expect(api.conv.list).toHaveBeenCalledWith('sr-1')
    // Most recent conversation is shown.
    expect(api.conv.load).toHaveBeenCalledWith('c1')
    expect(screen.getByTestId('ai-conversation-name').textContent).toBe('First chat')

    fireEvent.click(screen.getByTestId('ai-conversations-toggle'))
    fireEvent.click(screen.getByText('Second chat'))
    await act(async () => {})
    expect(useAiChatStore.getState().conversationId).toBe('c2')
    expect(screen.getAllByTestId('ai-bubble-text')[0].textContent).toBe('content of c2')

    fireEvent.click(screen.getByTestId('ai-conversations-toggle'))
    const list = screen.getByTestId('ai-conversation-list')
    fireEvent.click(within(list).getAllByTestId('ai-conversation-delete')[1])
    await act(async () => {})
    expect(api.conv.remove).toHaveBeenCalledWith('c2')
    expect(useAiChatStore.getState().messages).toEqual([])
  })
})

describe('Tools tab (#180)', () => {
  it('the picker lists the project saved MCP requests and adds one as a server', () => {
    useWorkspaceStore.setState({
      treeData: [
        {
          id: 'f',
          type: 'folder',
          label: 'F',
          children: [
            { id: 'ep-mcp', type: 'endpoint', label: 'Weather MCP', protocol: 'mcp' },
            { id: 'ep-http', type: 'endpoint', label: 'HTTP one', protocol: 'http' },
          ],
        },
      ],
    } as never)
    render(<AiChatEditor />)
    fireEvent.click(screen.getByTestId('ai-tools-toggle'))
    const picker = screen.getByTestId('ai-tools-pick-saved') as HTMLSelectElement
    expect([...picker.options].map((o) => o.textContent)).toEqual([
      'Add a saved MCP request…',
      'Weather MCP',
    ])
    fireEvent.change(picker, { target: { value: 'ep-mcp' } })
    expect(useAiChatStore.getState().toolServers).toEqual([
      expect.objectContaining({
        source: 'saved',
        requestId: 'ep-mcp',
        requestKind: 'endpoint',
        name: 'Weather MCP',
      }),
    ])
    expect(screen.getAllByTestId('ai-tool-server')).toHaveLength(1)
  })

  it('"Run tools without asking" shows its warning', () => {
    render(<AiChatEditor />)
    fireEvent.click(screen.getByTestId('ai-tools-toggle'))
    fireEvent.click(screen.getByTestId('ai-tools-auto-approve'))
    expect(useAiChatStore.getState().autoApproveTools).toBe(true)
    expect(screen.getByText(/without your approval/)).toBeTruthy()
  })
})
