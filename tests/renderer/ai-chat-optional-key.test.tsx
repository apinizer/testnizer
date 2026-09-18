/**
 * Issues #120 / #121 — AI Chat: Send must not require an API key, and
 * user-defined headers are resolved and sent with the request.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import React from 'react'

const sendSpy = vi.hoisted(() => vi.fn(async () => ({ success: true, data: { messageId: 'm1' } })))
vi.hoisted(() => {
  const g = globalThis as unknown as { window: { api?: unknown } }
  g.window.api = {
    aiChat: {
      send: sendSpy,
      cancel: vi.fn(async () => ({ success: true })),
      onChunk: () => () => {},
      onDone: () => () => {},
      onError: () => () => {},
      onCancelled: () => () => {},
    },
  }
})

import AiChatEditor from '../../src/renderer/components/protocols/AiChatEditor'
import { useAiChatStore, buildCustomHeaderMap } from '../../src/renderer/stores/ai-chat.store'
import { useEnvironmentStore } from '../../src/renderer/stores/environment.store'

beforeEach(() => {
  sendSpy.mockClear()
  useAiChatStore.setState({
    provider: 'custom',
    customUrl: 'https://gw.example/v1/chat/completions',
    apiKey: '',
    model: 'm',
    systemPrompt: '',
    customHeaders: [
      { id: 'h1', key: 'Authorization', value: 'Bearer {{gwToken}}', enabled: true },
      { id: 'h2', key: 'X-Disabled', value: 'nope', enabled: false },
      { id: 'h3', key: '', value: '', enabled: true },
    ],
    messages: [],
    streaming: false,
    pendingResponseId: null,
    pendingMessageId: null,
    errorMessage: null,
    _tabStates: new Map(),
    _currentTabId: null,
  })
  useEnvironmentStore.setState({
    ...useEnvironmentStore.getState(),
    getActiveVariables: () => ({ gwToken: 'abc123' }),
  } as never)
})

afterEach(cleanup)

describe('buildCustomHeaderMap', () => {
  it('keeps enabled non-blank rows and resolves {{vars}}', () => {
    const map = buildCustomHeaderMap(useAiChatStore.getState().customHeaders, { gwToken: 'abc123' })
    expect(map).toEqual({ Authorization: 'Bearer abc123' })
  })
})

describe('AI Chat — API key optional (issue #121)', () => {
  it('enables Send with an empty API key once there is a draft', () => {
    render(<AiChatEditor />)
    const send = screen.getByTitle('Send') as HTMLButtonElement
    expect(send.disabled).toBe(true)
    fireEvent.change(screen.getByPlaceholderText(/Ask anything/), { target: { value: 'hello' } })
    expect(send.disabled).toBe(false)
  })

  it('sendPrompt no longer refuses without an API key and forwards resolved headers', async () => {
    await useAiChatStore.getState().sendPrompt('hello')
    expect(useAiChatStore.getState().errorMessage).toBeNull()
    await waitFor(() => expect(sendSpy).toHaveBeenCalledTimes(1))
    const payload = (sendSpy.mock.calls[0] as unknown[])[0] as Record<string, unknown>
    expect(payload.apiKey).toBe('')
    expect(payload.headers).toEqual({ Authorization: 'Bearer abc123' })
  })

  it('omits the headers field entirely when no custom header is enabled', async () => {
    useAiChatStore.setState({ customHeaders: [] })
    await useAiChatStore.getState().sendPrompt('hello')
    const payload = (sendSpy.mock.calls[0] as unknown[])[0] as Record<string, unknown>
    expect(payload.headers).toBeUndefined()
  })
})
