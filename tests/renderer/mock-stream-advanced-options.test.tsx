/**
 * Issue #222 (4) + (5) — the response editor's advanced streaming fields:
 *
 *  - LLM row: each provider's own stop reasons (OpenAI finish_reason /
 *    Anthropic stop_reason, the wire value in the label), the stop sequence
 *    for Anthropic `stop_sequence`, the provider switch rewriting a reason
 *    the other wire cannot say, `fixed` chunking's size, and the mid-stream
 *    error (on / chunk count / type / message, provider defaults as
 *    placeholders);
 *  - Stream (SSE) row: the error event (on / event count / data).
 *
 * Every write goes through the main process's real save-time validation
 * (`validateLlmConfig` / `validateStreamConfig` wrapped around the stub), so
 * a field the UI writes but main would reject fails here. And every new
 * validator sentence is translated (TR) instead of passing through.
 *
 * Fail-before: no such fields; the stop-reason select offered stop / length
 * / tool_calls for both providers.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react'
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
import { useUIStore } from '../../src/renderer/stores/ui.store'
import { setLocale } from '../../src/renderer/lib/i18n'
import { translateStreamError } from '../../src/renderer/components/mock/mock-stream-errors'
import { validateLlmConfig, validateStreamConfig } from '../../src/shared/mock-stream'
import type { MockEndpoint, MockResponse, MockServer } from '../../src/renderer/types'

type UpdateImpl = (id: string, patch: Partial<MockResponse>) => Promise<unknown>
const realUpdate = httpBridge.response.update.getMockImplementation() as UpdateImpl

/** The stub's update, behind main's save-time validation for the body type. */
function validateWrites(validate: (cfg: unknown) => string | null): void {
  httpBridge.response.update.mockImplementation(((id: string, patch: Partial<MockResponse>) => {
    const err = patch.streamConfig !== undefined ? validate(patch.streamConfig) : null
    return err ? Promise.resolve({ success: false, error: err }) : realUpdate(id, patch)
  }) as never)
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

const lastWrite = (): Record<string, unknown> | undefined =>
  httpBridge.response.update.mock.calls.at(-1)?.[1]?.streamConfig as
    | Record<string, unknown>
    | undefined

const options = (testId: string): { value: string; label: string }[] =>
  within(screen.getByTestId(testId))
    .getAllByRole('option')
    .map((o) => ({ value: (o as HTMLOptionElement).value, label: o.textContent ?? '' }))

/** Type into a commit-on-blur text field. */
function commitText(testId: string, value: string): void {
  const box = screen.getByTestId(testId)
  fireEvent.focus(box)
  fireEvent.change(box, { target: { value } })
  fireEvent.blur(box)
}

function commitNumber(testId: string, value: string): void {
  const box = screen.getByTestId(testId)
  fireEvent.focus(box)
  fireEvent.change(box, { target: { value } })
  fireEvent.blur(box)
}

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

/** The editor reads the locale from the UI store; `t()` outside React from the module. */
function useLocale(locale: 'en' | 'tr'): void {
  useUIStore.setState({ locale })
  setLocale(locale)
}

beforeEach(() => useLocale('en'))
afterEach(() => {
  httpBridge.response.update.mockImplementation(realUpdate as never)
  cleanup()
  useLocale('en')
})

describe('LLM row: stop reason per provider', () => {
  it('OpenAI offers finish_reason values, Anthropic stop_reason values, wire value in the label', async () => {
    await mount(AI_SERVER, [CHAT_EP], [llm({})])
    expect(options('mock-llm-stop-reason')).toEqual([
      { value: 'stop', label: 'Natural end (stop)' },
      { value: 'length', label: 'Length limit (length)' },
      { value: 'content_filter', label: 'Content filter (content_filter)' },
      { value: 'tool_calls', label: 'Tool calls (tool_calls)' },
    ])
    cleanup()
    await mount(AI_SERVER, [CHAT_EP], [llm({ provider: 'anthropic' })])
    expect(options('mock-llm-stop-reason').map((o) => o.label)).toEqual([
      'Natural end (end_turn)',
      'Length limit (max_tokens)',
      'Stop sequence (stop_sequence)',
      'Refusal (refusal)',
      'Tool use (tool_use)',
    ])
  })

  it('Anthropic stop_sequence: the stop sequence field writes stopSequence; switching to OpenAI writes stop', async () => {
    validateWrites(validateLlmConfig)
    await mount(AI_SERVER, [CHAT_EP], [llm({ provider: 'anthropic', stopReason: 'stop_sequence' })])
    const seq = screen.getByTestId('mock-llm-stop-sequence') as HTMLInputElement
    expect(seq.value).toBe('')
    expect(seq.placeholder).toBe('END')
    commitText('mock-llm-stop-sequence', '\\n\\nUser:')
    await waitFor(() =>
      expect(lastWrite()).toMatchObject({
        stopReason: 'stop_sequence',
        stopSequence: '\\n\\nUser:',
      }),
    )

    fireEvent.change(screen.getByTestId('mock-llm-provider'), { target: { value: 'openai' } })
    await waitFor(() =>
      expect(lastWrite()).toMatchObject({ provider: 'openai', stopReason: 'stop' }),
    )
    expect(screen.queryByTestId('mock-llm-stop-sequence')).toBeNull()
    expect(screen.getByTestId('mock-llm-stop-reason')).toHaveValue('stop')
    expect(screen.queryByTestId('mock-llm-error')).toBeNull()
  })

  it('content_filter survives the switch (refusal on Anthropic)', async () => {
    validateWrites(validateLlmConfig)
    await mount(AI_SERVER, [CHAT_EP], [llm({ stopReason: 'content_filter' })])
    fireEvent.change(screen.getByTestId('mock-llm-provider'), { target: { value: 'anthropic' } })
    await waitFor(() =>
      expect(lastWrite()).toMatchObject({ provider: 'anthropic', stopReason: 'content_filter' }),
    )
    expect(screen.getByTestId('mock-llm-stop-reason')).toHaveValue('content_filter')
  })
})

describe('LLM row: chunking modes', () => {
  it('offers fixed size and whole message; fixed shows the chunk size, which is saved', async () => {
    validateWrites(validateLlmConfig)
    await mount(AI_SERVER, [CHAT_EP], [llm({})])
    expect(options('mock-llm-chunking').map((o) => o.value)).toEqual([
      'word',
      'char',
      'sentence',
      'fixed',
      'whole',
    ])
    expect(screen.queryByTestId('mock-llm-chunk-size')).toBeNull()
    fireEvent.change(screen.getByTestId('mock-llm-chunking'), { target: { value: 'fixed' } })
    await waitFor(() => expect(lastWrite()).toMatchObject({ chunking: 'fixed' }))
    expect(await screen.findByTestId('mock-llm-chunk-size')).toHaveValue(8)
    commitNumber('mock-llm-chunk-size', '5')
    await waitFor(() => expect(lastWrite()).toMatchObject({ chunking: 'fixed', chunkSize: 5 }))
    expect(screen.queryByTestId('mock-llm-error')).toBeNull()
  })
})

describe('LLM row: mid-stream error', () => {
  it('on → after 3 chunks with the provider default; type / message / count are saved; off removes it', async () => {
    validateWrites(validateLlmConfig)
    await mount(AI_SERVER, [CHAT_EP], [llm({})])
    expect(screen.queryByTestId('mock-llm-stream-error-after')).toBeNull()
    fireEvent.click(screen.getByTestId('mock-llm-stream-error-on'))
    await waitFor(() => expect(lastWrite()).toMatchObject({ streamError: { afterChunks: 3 } }))
    expect((screen.getByTestId('mock-llm-stream-error-type') as HTMLInputElement).placeholder).toBe(
      'server_error',
    )
    expect(screen.getByTestId('mock-llm-stream-error-hint').textContent).toContain('[DONE]')

    commitText('mock-llm-stream-error-type', 'rate_limit_error')
    await waitFor(() =>
      expect(lastWrite()).toMatchObject({
        streamError: { afterChunks: 3, type: 'rate_limit_error' },
      }),
    )
    commitText('mock-llm-stream-error-message', 'Slow down')
    commitNumber('mock-llm-stream-error-after', '1')
    await waitFor(() =>
      expect(lastWrite()).toMatchObject({
        streamError: { afterChunks: 1, type: 'rate_limit_error', message: 'Slow down' },
      }),
    )

    fireEvent.click(screen.getByTestId('mock-llm-stream-error-on'))
    await waitFor(() => expect(lastWrite()?.streamError).toBeUndefined())
    expect(screen.queryByTestId('mock-llm-stream-error-type')).toBeNull()
    expect(screen.queryByTestId('mock-llm-error')).toBeNull()
  })

  it('Anthropic: overloaded_error / Overloaded are the defaults; the hint names event: error (TR)', async () => {
    useLocale('tr')
    await mount(
      AI_SERVER,
      [CHAT_EP],
      [llm({ provider: 'anthropic', streamError: { afterChunks: 2 } })],
    )
    expect((screen.getByTestId('mock-llm-stream-error-type') as HTMLInputElement).placeholder).toBe(
      'overloaded_error',
    )
    expect(
      (screen.getByTestId('mock-llm-stream-error-message') as HTMLInputElement).placeholder,
    ).toBe('Overloaded')
    expect(screen.getByTestId('mock-llm-stream-error-after')).toHaveValue(2)
    const hint = screen.getByTestId('mock-llm-stream-error-hint').textContent ?? ''
    expect(hint).toContain('event: error')
    expect(hint).toContain('akış kapanır')
    expect(options('mock-llm-stop-reason')[0].label).toBe('Doğal bitiş (end_turn)')
  })
})

describe('Stream (SSE) row: error event', () => {
  const SSE = { intervalMs: 1000, heartbeatMs: 0, loop: false, onEnd: 'close', resume: true }

  it('on → the default event; count and data are saved; off removes it', async () => {
    validateWrites(validateStreamConfig)
    await mount(
      httpServer({ id: 'srv-1', kind: 'sse' }),
      [httpEndpoint({ serverId: 'srv-1' })],
      [httpResponse({ bodyType: 'sse', body: 'data: a\n', streamConfig: SSE })],
    )
    fireEvent.click(screen.getByTestId('mock-sse-error-event-on'))
    await waitFor(() =>
      expect(lastWrite()).toEqual({
        ...SSE,
        errorEvent: { afterEvents: 3, data: '{"message": "Mock stream error"}' },
      }),
    )
    commitNumber('mock-sse-error-event-after', '1')
    commitText('mock-sse-error-event-data', '{"code": 503}')
    await waitFor(() =>
      expect(lastWrite()).toEqual({
        ...SSE,
        errorEvent: { afterEvents: 1, data: '{"code": 503}' },
      }),
    )
    expect(screen.getByTestId('mock-sse-error-event-hint').textContent).toContain('event: error')
    fireEvent.click(screen.getByTestId('mock-sse-error-event-on'))
    await waitFor(() => expect(lastWrite()?.errorEvent).toBeUndefined())
    expect(screen.queryByTestId('mock-sse-error')).toBeNull()
  })
})

describe('every new validator sentence is translated', () => {
  const sentences = [
    validateLlmConfig({ chunking: 'token' }),
    validateLlmConfig({ chunkSize: 0 }),
    validateLlmConfig({ stopReason: 'pause_turn' }),
    validateLlmConfig({ stopSequence: '' }),
    validateLlmConfig({ streamError: 1 }),
    validateLlmConfig({ streamError: { afterChunks: 1, status: 1 } }),
    validateLlmConfig({ streamError: { afterChunks: -1 } }),
    validateLlmConfig({ streamError: { afterChunks: 1, type: 'x'.repeat(200) } }),
    validateLlmConfig({ streamError: { afterChunks: 1, message: 1 } }),
    validateStreamConfig({ errorEvent: 1 }),
    validateStreamConfig({ errorEvent: { afterEvents: 1, data: '', x: 1 } }),
    validateStreamConfig({ errorEvent: { afterEvents: -1, data: '' } }),
    validateStreamConfig({ errorEvent: { afterEvents: 1 } }),
  ]

  it.each(['en', 'tr'] as const)(
    '%s: no sentence passes through, every placeholder is filled',
    (locale) => {
      useLocale(locale)
      for (const s of sentences) {
        expect(s).not.toBeNull()
        const shown = translateStreamError(s!)
        if (locale === 'tr') expect(shown).not.toBe(s)
        expect(shown).not.toMatch(/\{(max|name|n)\}/)
      }
    },
  )
})
