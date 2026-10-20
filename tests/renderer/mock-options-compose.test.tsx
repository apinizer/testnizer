/**
 * Issue #221 review (PR #225), item 5 — the Stream (SSE) and LLM option rows
 * write their config as `{...cfg, ...patch}`, where `cfg` came from the last
 * render. Two quick changes (Loop, then the interval) before the store had
 * the first answer back sent the second write over the OLD config: the
 * second save reverted the first. And the LLM row wrote the NORMALIZED
 * config, which drops a stored tool call `normalizeToolCall` rejects — an
 * unrelated change (chunking) silently deleted the user's hand-edited call.
 *
 * Now each write merges over the last written config while writes are in
 * flight, and the LLM row keeps the stored tool-call list as stored (an
 * invalid call stays; the main process's validation reports it).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
import React from 'react'
// Must come first: installs window.api.mock before mock.store captures it at import.
import {
  httpBridge,
  httpEndpoint,
  httpResponse,
  httpServer,
  resetHttpBridge,
  seedHttpBridge,
} from './mock-http-bridge-stub'

vi.mock('../../src/renderer/components/shared/MonacoWrapper', () => ({
  default: ({ value }: { value?: string }) =>
    React.createElement('div', { 'data-monaco': '' }, value),
}))

import MockServerEditor from '../../src/renderer/components/mock/MockServerEditor'
import { useMockStore } from '../../src/renderer/stores/mock.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { setLocale } from '../../src/renderer/lib/i18n'
import type { MockEndpoint, MockResponse, MockServer } from '../../src/renderer/types'

type UpdateImpl = (id: string, patch: Partial<MockResponse>) => Promise<unknown>
const realUpdate = httpBridge.response.update.getMockImplementation() as UpdateImpl

/** Hold every `response.update` until released, in call order. */
function holdUpdates(): { release: () => Promise<void> } {
  const held: (() => void)[] = []
  httpBridge.response.update.mockImplementation(
    ((id: string, patch: Partial<MockResponse>) =>
      new Promise((resolve) => held.push(() => resolve(realUpdate(id, patch))))) as never,
  )
  return {
    release: async () => {
      while (held.length > 0) {
        await act(async () => {
          held.shift()!()
          await Promise.resolve()
        })
      }
    },
  }
}

async function mount(server: MockServer, endpoints: MockEndpoint[], responses: MockResponse[]) {
  resetHttpBridge([server])
  seedHttpBridge({ endpoints, responses })
  useMockStore.setState({
    servers: [server],
    endpointsByServer: {},
    responsesByEndpoint: {},
    statusByServer: {},
    errorByServer: {},
    logsByServer: {},
  })
  useTabsStore.setState({ tabs: [], activeTabId: null })
  render(React.createElement(MockServerEditor, { serverId: server.id }))
  await screen.findByTestId('mock-response-body-type')
}

/** The response's config as the store holds it now. */
function stored(): unknown {
  const all = Object.values(useMockStore.getState().responsesByEndpoint).flat()
  return all.find((r) => r.id === 'r-1')?.streamConfig
}

const lastWrite = (): unknown => httpBridge.response.update.mock.calls.at(-1)?.[1]?.streamConfig

beforeEach(() => setLocale('en'))
afterEach(() => {
  httpBridge.response.update.mockImplementation(realUpdate as never)
  cleanup()
})

const SSE = { intervalMs: 1000, heartbeatMs: 0, loop: false, onEnd: 'close', resume: true }

describe('Stream row: quick changes compose', () => {
  it('Loop on, then the interval, before the first save returns → both persist', async () => {
    await mount(
      httpServer({ id: 'srv-1', kind: 'sse' }),
      [httpEndpoint({ serverId: 'srv-1' })],
      [httpResponse({ bodyType: 'sse', body: 'data: a\n', streamConfig: SSE })],
    )
    const held = holdUpdates()
    fireEvent.click(screen.getByTestId('mock-stream-loop'))
    const interval = screen.getByTestId('mock-stream-interval')
    fireEvent.focus(interval)
    fireEvent.change(interval, { target: { value: '250' } })
    fireEvent.blur(interval)
    // Every write after the first carries Loop (the draft writes on change and on blur).
    expect(httpBridge.response.update.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(lastWrite()).toEqual({ ...SSE, loop: true, intervalMs: 250 })
    await held.release()
    await waitFor(() => expect(stored()).toEqual({ ...SSE, loop: true, intervalMs: 250 }))
    expect(screen.getByTestId('mock-stream-loop')).toBeChecked()
    expect(screen.getByTestId('mock-stream-interval')).toHaveValue(250)
  })
})

const LLM = {
  provider: 'openai',
  chunking: 'word',
  chunkIntervalMs: 30,
  stopReason: 'stop',
  toolCalls: [],
  usage: 'auto',
}
const AI_SERVER = httpServer({ id: 'srv-1', kind: 'ai', port: 3300 })
const CHAT_EP = httpEndpoint({ serverId: 'srv-1', method: 'POST', path: '/v1/chat/completions' })
const llm = (cfg: Record<string, unknown>): MockResponse =>
  httpResponse({
    bodyType: 'llm',
    body: 'Hi',
    streamConfig: { ...LLM, ...cfg } as MockResponse['streamConfig'],
  })

describe('LLM row: quick changes compose; stored tool calls survive', () => {
  it('provider, then the chunk interval, before the first save returns → both persist', async () => {
    await mount(AI_SERVER, [CHAT_EP], [llm({})])
    const held = holdUpdates()
    fireEvent.change(screen.getByTestId('mock-llm-provider'), { target: { value: 'anthropic' } })
    const interval = screen.getByTestId('mock-llm-interval')
    fireEvent.focus(interval)
    fireEvent.change(interval, { target: { value: '80' } })
    fireEvent.blur(interval)
    expect(lastWrite()).toEqual({ ...LLM, provider: 'anthropic', chunkIntervalMs: 80 })
    await held.release()
    await waitFor(() =>
      expect(stored()).toEqual({ ...LLM, provider: 'anthropic', chunkIntervalMs: 80 }),
    )
  })

  it('a stored tool call normalizeToolCall rejects survives a chunking change', async () => {
    // No name: the tolerant read drops it — the row used to write that back.
    const handEdited = [{ arguments: { city: 'Ankara' } }, { name: 'ok', arguments: {} }]
    await mount(AI_SERVER, [CHAT_EP], [llm({ stopReason: 'tool_calls', toolCalls: handEdited })])
    // Shown as stored, so the user can fix it; the reply counts as calling tools.
    expect(
      JSON.parse((screen.getByTestId('mock-llm-tool-calls') as HTMLTextAreaElement).value),
    ).toEqual(handEdited)
    expect(screen.getByTestId('mock-llm-stop-reason')).toBeDisabled()

    fireEvent.change(screen.getByTestId('mock-llm-chunking'), { target: { value: 'char' } })
    await waitFor(() => expect(httpBridge.response.update).toHaveBeenCalledTimes(1))
    expect(lastWrite()).toEqual({
      ...LLM,
      chunking: 'char',
      stopReason: 'tool_calls',
      toolCalls: handEdited,
    })
  })
})
