/**
 * Issue #222 (5) — in the AI Chat tab, a mid-stream provider error keeps the
 * text that already arrived and shows the provider's error under it: the
 * store folds `aichat:chunk` deltas into the turn, then `aichat:error`
 * finishes it with `error` (and the call metrics); the turn renders the
 * partial text AND the `ai-turn-error` line.
 *
 * The main side (the client raising on the error payload, the IPC order
 * chunk → error, the Console error entry) is pinned in
 * `tests/main/handlers/ai-chat-stream-error.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import React from 'react'

const api = vi.hoisted(() => ({
  send: vi.fn(async () => ({ success: true, data: { messageId: 'm1' } })),
}))

vi.hoisted(() => {
  const g = globalThis as unknown as { window: { api?: unknown } }
  g.window.api = {
    aiChat: {
      send: api.send,
      cancel: vi.fn(async () => ({ success: true, data: { cancelled: true } })),
      onChunk: () => () => {},
      onDone: () => () => {},
      onError: () => () => {},
      onCancelled: () => () => {},
      onEvent: () => () => {},
      conversations: {
        list: vi.fn(async () => ({ success: true, data: [] })),
        create: vi.fn(async (input: { name: string }) => ({
          success: true,
          data: { id: 'conv-1', name: input.name, turns: [] },
        })),
        append: vi.fn(async () => ({
          success: true,
          data: { id: 'conv-1', updatedAt: 1, turnCount: 2 },
        })),
        load: vi.fn(),
        rename: vi.fn(),
        remove: vi.fn(),
        rehome: vi.fn(),
        dropTab: vi.fn(),
      },
    },
    endpoint: { get: vi.fn() },
  }
})

import { useAiChatStore } from '../../src/renderer/stores/ai-chat.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import AiChatAssistantTurn from '../../src/renderer/components/protocols/ai-chat/AiChatAssistantTurn'

beforeEach(() => {
  vi.clearAllMocks()
  useTabsStore.setState({
    tabs: [{ id: 'tab-1', name: 'AI', protocol: 'ai', isDirty: false, isLoading: false }],
    activeTabId: 'tab-1',
  } as never)
  useAiChatStore.setState({
    provider: 'anthropic',
    customUrl: '',
    apiKey: '',
    model: 'claude-mock',
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
  } as never)
})

describe('AI Chat turn after a mid-stream error', () => {
  it('keeps the partial text and shows the provider error under it', async () => {
    await useAiChatStore.getState().sendPrompt('hi')
    const s = useAiChatStore.getState()
    s._onChunk('m1', 'one ')
    s._onChunk('m1', 'two ')
    const error = 'Mid-stream error (overloaded_error): Overloaded'
    // What the handler sends: the turn metrics (one call, HTTP 200 + the error).
    const call = { status: 200, ttfbMs: 5, durationMs: 40, usageReported: false, error }
    s._onError('m1', error, {
      calls: [call],
      status: 200,
      ttfbMs: 5,
      durationMs: 40,
      usageReported: false,
    })

    const state = useAiChatStore.getState()
    expect(state.streaming).toBe(false)
    expect(state.errorMessage).toBe(error)
    const turn = state.messages.at(-1)
    if (turn?.role !== 'assistant') throw new Error('no assistant turn')
    expect(turn.content).toBe('one two ')
    expect(turn.error).toBe(error)
    expect(turn.metrics?.calls[0]).toMatchObject({ status: 200, error })

    render(React.createElement(AiChatAssistantTurn, { turn, streaming: false }))
    expect(screen.getByText(/one two/)).toBeTruthy()
    expect(screen.getByTestId('ai-turn-error').textContent).toBe(error)
    // PM review #11: a 200 whose stream broke is not a green success chip,
    // and the TTFB the call measured is shown (not "—").
    const status = screen.getByTestId('ai-metrics-status')
    expect(status.getAttribute('data-status')).toBe('interrupted')
    expect(status.textContent).toBe('200 · interrupted')
    expect(status.getAttribute('style')).toContain('var(--orange)')
    expect(screen.getByTestId('ai-metrics').textContent).toContain('TTFB 5')
  })

  it('a clean 200 keeps the green chip; an HTTP error stays red', () => {
    cleanup()
    const metrics = {
      calls: [{ status: 200, ttfbMs: 5, durationMs: 40, usageReported: false }],
      status: 200,
      ttfbMs: 5,
      durationMs: 40,
      usageReported: false,
    }
    const ok = render(
      React.createElement(AiChatAssistantTurn, {
        turn: { id: 'a', role: 'assistant', content: 'x', metrics, timestamp: 1 },
        streaming: false,
      }),
    )
    expect(screen.getByTestId('ai-metrics-status').getAttribute('data-status')).toBe('ok')
    expect(screen.getByTestId('ai-metrics-status').textContent).toBe('200')
    ok.unmount()
    render(
      React.createElement(AiChatAssistantTurn, {
        turn: {
          id: 'b',
          role: 'assistant',
          content: '',
          error: 'HTTP 429',
          metrics: { ...metrics, status: 429, calls: [{ ...metrics.calls[0], status: 429 }] },
          timestamp: 1,
        },
        streaming: false,
      }),
    )
    expect(screen.getByTestId('ai-metrics-status').getAttribute('data-status')).toBe('error')
    expect(screen.getByTestId('ai-metrics-status').textContent).toBe('429')
  })
})
