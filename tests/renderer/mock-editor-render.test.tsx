/**
 * MockServerEditor — render smoke + the per-kind surface (issue #221).
 *
 * Smoke: guards against the "Maximum update depth exceeded" / "getSnapshot
 * should be cached" regression caused by Zustand selectors that emit a new
 * `[]` literal on every render.
 *
 * Per kind: the header badge, the body types the response editor offers
 * (http: json/xml/text/html, sse: sse/json/text — plus a stored value that is
 * not in the list), the HTTP-only import / JWKS buttons, the SSE "Open in SSE
 * tab" button, the Stream row (Resume off while looping) and stream-setting
 * errors that used to be swallowed by the store.
 *
 * AI (Faz 2b): badge AI, llm/json, the "Open in AI Chat tab" header button
 * and its disabled reason, the SDK base URL line, the LLM row (tool calls
 * JSON, translated rejections), "Add" on an AI server, the LLM cURL, and a
 * body-type switch that writes the new type's fresh settings in the same
 * update.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, within, act } from '@testing-library/react'
import React from 'react'
// Must come first: installs window.api.mock before mock.store captures it at import.
import {
  calls,
  httpBridge,
  httpEndpoint,
  httpResponse,
  httpServer,
  resetHttpBridge,
  seedHttpBridge,
} from './mock-http-bridge-stub'

// Stub Monaco — it does heavy DOM work that doesn't help these checks.
vi.mock('../../src/renderer/components/shared/MonacoWrapper', () => ({
  default: ({ value }: { value?: string }) =>
    React.createElement('div', { 'data-monaco': '' }, value),
}))

import MockServerEditor from '../../src/renderer/components/mock/MockServerEditor'
import { useMockStore } from '../../src/renderer/stores/mock.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { setLocale } from '../../src/renderer/lib/i18n'
import { translateStreamError } from '../../src/renderer/components/mock/mock-stream-errors'
import { buildMockCurl } from '../../src/renderer/components/mock/mock-curl'
import type { MockEndpoint, MockResponse, MockServer } from '../../src/renderer/types'

const TICKER = 'id: {{stream.seq}}\nevent: tick\ndata: {"n": {{stream.seq}}}\n'
const LOOPING = {
  intervalMs: 1000,
  heartbeatMs: 15000,
  loop: true,
  onEnd: 'keep-open',
  resume: false,
}

async function mount(
  server: MockServer,
  data: {
    endpoints?: MockEndpoint[]
    responses?: MockResponse[]
    failResponseUpdate?: string
  } = {},
): Promise<void> {
  resetHttpBridge([server])
  seedHttpBridge(data)
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
  if (data.endpoints?.length) await screen.findByTestId('mock-endpoint-path')
  if (data.responses?.length) await screen.findByTestId('mock-response-body-type')
}

const LLM_DEFAULTS = {
  provider: 'openai',
  chunking: 'word',
  chunkIntervalMs: 30,
  stopReason: 'stop',
  toolCalls: [],
  usage: 'auto',
}
const SSE_DEFAULTS = { intervalMs: 1000, heartbeatMs: 0, loop: false, onEnd: 'close', resume: true }
const AI_SERVER = httpServer({ id: 'srv-1', kind: 'ai', port: 3300, name: 'Chat API' })
const CHAT_EP = httpEndpoint({ serverId: 'srv-1', method: 'POST', path: '/v1/chat/completions' })
const llm = (cfg: Record<string, unknown> = {}, over: Partial<MockResponse> = {}): MockResponse =>
  httpResponse({
    bodyType: 'llm',
    body: 'Hello from the mock LLM. You said: {{lastUserMessage}}',
    streamConfig: { ...LLM_DEFAULTS, ...cfg } as MockResponse['streamConfig'],
    ...over,
  })

const options = (): string[] =>
  within(screen.getByTestId('mock-response-body-type'))
    .getAllByRole('option')
    .map((o) => o.getAttribute('value') ?? '')

beforeEach(() => setLocale('en'))
afterEach(() => cleanup())

describe('MockServerEditor — render smoke', () => {
  it('renders without infinite-loop crashes when the server has no endpoints yet', async () => {
    await mount(httpServer({ id: 'srv-1', name: 'Test Server' }))
    expect(screen.getByText('Test Server')).not.toBeNull()
  })

  it('renders the Endpoints / Settings / Logs tabs', async () => {
    await mount(httpServer({ id: 'srv-1' }))
    expect(screen.getAllByRole('button').length).toBeGreaterThan(0)
  })

  it('handles an unknown serverId gracefully', () => {
    useMockStore.setState({ servers: [] })
    render(React.createElement(MockServerEditor, { serverId: 'unknown' }))
    expect(document.body.textContent).toBeTruthy()
  })

  it('a server without a stored kind (older row) renders as HTTP', async () => {
    const legacy = httpServer({ id: 'srv-1' }) as Partial<MockServer>
    delete legacy.kind
    await mount(legacy as MockServer)
    expect(screen.getByTestId('mock-kind-badge')).toHaveTextContent('HTTP')
  })
})

describe('MockServerEditor — per kind (issue #221)', () => {
  it('HTTP: badge HTTP, json/xml/text/html, import + JWKS shown, no SSE button', async () => {
    await mount(httpServer({ id: 'srv-1' }), {
      endpoints: [httpEndpoint({ serverId: 'srv-1', path: '/users' })],
      responses: [httpResponse()],
    })
    expect(screen.getByTestId('mock-kind-badge')).toHaveTextContent('HTTP')
    expect(options()).toEqual(['json', 'xml', 'text', 'html'])
    expect(screen.getByTestId('mock-import-openapi')).toBeInTheDocument()
    expect(screen.getByTestId('mock-import-postman')).toBeInTheDocument()
    expect(screen.getByTestId('mock-jwks-serve')).toBeInTheDocument()
    expect(screen.queryByTestId('mock-open-in-sse')).toBeNull()
    expect(screen.queryByTestId('mock-stream-interval')).toBeNull()
  })

  it('SSE: badge SSE, sse/json/text, import + JWKS hidden, Start & open in SSE tab', async () => {
    await mount(httpServer({ id: 'srv-1', kind: 'sse', port: 3200 }), {
      endpoints: [httpEndpoint({ serverId: 'srv-1' })],
      responses: [httpResponse({ bodyType: 'sse', body: TICKER, streamConfig: LOOPING })],
    })
    expect(screen.getByTestId('mock-kind-badge')).toHaveTextContent('SSE')
    expect(options()).toEqual(['sse', 'json', 'text'])
    expect(screen.queryByTestId('mock-import-openapi')).toBeNull()
    expect(screen.queryByTestId('mock-import-postman')).toBeNull()
    expect(screen.queryByTestId('mock-jwks-serve')).toBeNull()
    const open = screen.getByTestId('mock-open-in-sse')
    expect(open).toHaveTextContent('Start & open in SSE tab')
    expect(open).not.toBeDisabled()
    expect(screen.getByTestId('mock-endpoint-open-in-sse')).toBeInTheDocument()
  })

  it('a stored body type the kind does not offer is still listed (and selected)', async () => {
    await mount(httpServer({ id: 'srv-1', kind: 'sse' }), {
      endpoints: [httpEndpoint({ serverId: 'srv-1' })],
      responses: [httpResponse({ bodyType: 'xml', body: '<a/>' })],
    })
    expect(options()).toEqual(['sse', 'json', 'text', 'xml'])
    expect(screen.getByTestId('mock-response-body-type')).toHaveValue('xml')
    // Not an sse response → no Stream row.
    expect(screen.queryByTestId('mock-stream-interval')).toBeNull()
  })

  it('SSE without a GET endpoint: the header button is disabled and says why', async () => {
    await mount(httpServer({ id: 'srv-1', kind: 'sse' }), {
      endpoints: [httpEndpoint({ serverId: 'srv-1', method: 'POST' })],
    })
    const open = screen.getByTestId('mock-open-in-sse')
    expect(open).toBeDisabled()
    expect(open.getAttribute('title')).toBe('Add a GET endpoint with an exact path first')
  })

  it('Stream row: Resume is off while Loop is on, and says why', async () => {
    await mount(httpServer({ id: 'srv-1', kind: 'sse' }), {
      endpoints: [httpEndpoint({ serverId: 'srv-1' })],
      responses: [
        httpResponse({ bodyType: 'sse', body: 'id: 1\ndata: a\n', streamConfig: LOOPING }),
      ],
    })
    expect(screen.getByTestId('mock-stream-interval')).toHaveValue(1000)
    expect(screen.getByTestId('mock-stream-heartbeat')).toHaveValue(15000)
    expect(screen.getByTestId('mock-stream-loop')).toBeChecked()
    expect(screen.getByTestId('mock-stream-on-end')).toHaveValue('keep-open')
    expect(screen.getByTestId('mock-stream-resume')).toBeDisabled()
    expect(screen.getByTestId('mock-sse-resume-reason')).toHaveTextContent('Loop')

    // Loop off + fixed ids → Resume becomes available.
    fireEvent.click(screen.getByTestId('mock-stream-loop'))
    await waitFor(() => expect(screen.getByTestId('mock-stream-resume')).not.toBeDisabled())
    expect(httpBridge.response.update).toHaveBeenLastCalledWith('r-1', {
      streamConfig: { ...LOOPING, loop: false },
    })
  })

  it('Resume is off for an id rendered from a template', async () => {
    await mount(httpServer({ id: 'srv-1', kind: 'sse' }), {
      endpoints: [httpEndpoint({ serverId: 'srv-1' })],
      responses: [
        httpResponse({ bodyType: 'sse', body: TICKER, streamConfig: { ...LOOPING, loop: false } }),
      ],
    })
    expect(screen.getByTestId('mock-stream-resume')).toBeDisabled()
    expect(screen.getByTestId('mock-sse-resume-reason')).toHaveTextContent('{{')
  })

  it('a stored config with foreign keys is written back clean (no "Unknown stream setting")', async () => {
    await mount(httpServer({ id: 'srv-1', kind: 'sse' }), {
      endpoints: [httpEndpoint({ serverId: 'srv-1' })],
      responses: [
        httpResponse({
          bodyType: 'sse',
          body: 'data: a\n',
          streamConfig: { intervalMs: 50, junk: 1 } as unknown as MockResponse['streamConfig'],
        }),
      ],
    })
    fireEvent.change(screen.getByTestId('mock-stream-on-end'), { target: { value: 'keep-open' } })
    await waitFor(() =>
      expect(httpBridge.response.update).toHaveBeenLastCalledWith('r-1', {
        streamConfig: {
          intervalMs: 50,
          heartbeatMs: 0,
          loop: false,
          onEnd: 'keep-open',
          resume: true,
        },
      }),
    )
  })

  it('a rejected stream setting is shown (translated), not swallowed', async () => {
    await mount(httpServer({ id: 'srv-1', kind: 'sse' }), {
      endpoints: [httpEndpoint({ serverId: 'srv-1' })],
      responses: [httpResponse({ bodyType: 'sse', body: 'data: a\n' })],
      failResponseUpdate: 'Loop must be true or false',
    })
    fireEvent.click(screen.getByTestId('mock-stream-loop'))
    const alert = await screen.findByTestId('mock-sse-error')
    expect(alert).toHaveAttribute('role', 'alert')
    expect(alert).toHaveTextContent('Loop must be on or off')
  })

  it('engine stream-setting errors map to both locales; unknown text passes through', () => {
    expect(translateStreamError('Unknown stream setting: junk')).toBe(
      'Unknown stream setting: junk',
    )
    setLocale('tr')
    expect(translateStreamError('Unknown stream setting: junk')).toBe('Bilinmeyen akış ayarı: junk')
    expect(
      translateStreamError(
        'Event interval must be a whole number of milliseconds between 0 and 600000',
      ),
    ).toBe('Olay aralığı 0 ile 600000 arasında tam sayı (ms) olmalı')
    expect(translateStreamError('Loop must be true or false')).toBe(
      'Döngü açık ya da kapalı olmalı',
    )
    expect(translateStreamError('Port in use')).toBe('Port in use')
  })

  it('an SSE body without any event warns', async () => {
    await mount(httpServer({ id: 'srv-1', kind: 'sse' }), {
      endpoints: [httpEndpoint({ serverId: 'srv-1' })],
      responses: [httpResponse({ bodyType: 'sse', body: '\n\n  \n' })],
    })
    expect(screen.getByTestId('mock-sse-no-events')).toHaveTextContent('No events parsed')
    expect(screen.getByTestId('mock-sse-hint')).toHaveTextContent('{{stream.seq}}')
  })

  it('SSE "Add" creates GET /events-2 with a ticker response when /events exists', async () => {
    await mount(httpServer({ id: 'srv-1', kind: 'sse' }), {
      endpoints: [httpEndpoint({ serverId: 'srv-1' })],
    })
    calls.length = 0
    await act(async () => {
      fireEvent.click(screen.getByTestId('mock-add-endpoint'))
    })
    await waitFor(() => expect(httpBridge.response.create).toHaveBeenCalledTimes(1))
    expect(httpBridge.endpoint.create).toHaveBeenCalledWith(
      expect.objectContaining({
        serverId: 'srv-1',
        method: 'GET',
        path: '/events-2',
        pathMode: 'exact',
      }),
    )
    expect(httpBridge.response.create).toHaveBeenCalledWith(
      expect.objectContaining({
        bodyType: 'sse',
        body: expect.stringContaining('{{stream.seq}}'),
        streamConfig: LOOPING,
      }),
    )
    expect(calls.filter((c) => c.endsWith('.create'))).toEqual([
      'endpoint.create',
      'response.create',
    ])
  })

  it('HTTP "Add" still creates GET /new-endpoint with no response', async () => {
    await mount(httpServer({ id: 'srv-1' }))
    await act(async () => {
      fireEvent.click(screen.getByTestId('mock-add-endpoint'))
    })
    await waitFor(() => expect(httpBridge.endpoint.create).toHaveBeenCalledTimes(1))
    expect(httpBridge.endpoint.create).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'GET', path: '/new-endpoint' }),
    )
    expect(httpBridge.response.create).not.toHaveBeenCalled()
  })
})

describe('MockServerEditor — AI kind (issue #221, Faz 2b)', () => {
  it('AI: badge AI, llm/json, import + JWKS hidden, Start & open in AI Chat tab, SDK base URL', async () => {
    await mount(AI_SERVER, { endpoints: [CHAT_EP], responses: [llm()] })
    expect(screen.getByTestId('mock-kind-badge')).toHaveTextContent('AI')
    expect(options()).toEqual(['llm', 'json'])
    expect(screen.queryByTestId('mock-import-openapi')).toBeNull()
    expect(screen.queryByTestId('mock-jwks-serve')).toBeNull()
    const open = screen.getByTestId('mock-open-in-ai-chat')
    expect(open).toHaveTextContent('Start & open in AI Chat tab')
    expect(open).not.toBeDisabled()
    expect(screen.queryByTestId('mock-open-in-sse')).toBeNull()
    // No per-endpoint AI Chat (or SSE) button — the header one is enough.
    expect(screen.queryByTestId('mock-endpoint-open-in-sse')).toBeNull()
    expect(screen.getByTestId('mock-sdk-base-url')).toHaveTextContent('http://127.0.0.1:3300/v1')
    expect(screen.getByTestId('mock-sdk-base-url-copy')).toBeInTheDocument()
    expect(screen.getByTestId('mock-base-url')).toHaveTextContent('http://127.0.0.1:3300')
  })

  it('an HTTP / SSE server has no SDK base URL line', async () => {
    await mount(httpServer({ id: 'srv-1', kind: 'sse' }))
    expect(screen.queryByTestId('mock-sdk-base-url')).toBeNull()
  })

  it('Settings tab: an AI server says which SDK base URL to use (same as the header line)', async () => {
    await mount({ ...AI_SERVER, basePath: 'llm' })
    fireEvent.click(screen.getByTestId('mock-tab-settings'))
    const hint = screen.getByTestId('mock-settings-ai-hint')
    expect(hint).toHaveTextContent(
      'Any OpenAI / Anthropic SDK works with base URL http://127.0.0.1:3300/llm/v1; auth is none by default.',
    )
    expect(screen.getByTestId('mock-sdk-base-url')).toHaveTextContent(
      'http://127.0.0.1:3300/llm/v1',
    )
  })

  it('Settings tab: HTTP and SSE servers show no AI SDK hint', async () => {
    for (const kind of ['http', 'sse'] as const) {
      await mount(httpServer({ id: 'srv-1', kind }))
      fireEvent.click(screen.getByTestId('mock-tab-settings'))
      expect(screen.getByText('Base path')).toBeInTheDocument()
      expect(screen.queryByTestId('mock-settings-ai-hint')).toBeNull()
      cleanup()
    }
  })

  it('AI without a chat endpoint (Anthropic only): the Anthropic button replaces the OpenAI one', async () => {
    await mount(AI_SERVER, {
      endpoints: [httpEndpoint({ serverId: 'srv-1', method: 'POST', path: '/v1/messages' })],
    })
    // Issue #222: no disabled "Add POST /v1/chat/completions first" on an
    // Anthropic server — "Open in AI Chat (Anthropic)" instead.
    expect(screen.queryByTestId('mock-open-in-ai-chat')).toBeNull()
    expect(screen.getByTestId('mock-open-in-ai-chat-anthropic')).toBeEnabled()
    expect(screen.getByTestId('mock-endpoint-path')).toHaveValue('/v1/messages')
  })

  it('AI with no endpoint: the empty list says what Add creates', async () => {
    await mount(AI_SERVER)
    expect(screen.getByText(/No chat endpoints yet/)).toBeInTheDocument()
  })

  it('LLM row: the stored settings, and every change writes the whole normalized config', async () => {
    await mount(AI_SERVER, { endpoints: [CHAT_EP], responses: [llm({ chunkIntervalMs: 50 })] })
    expect(screen.getByTestId('mock-llm-provider')).toHaveValue('openai')
    expect(screen.getByTestId('mock-llm-chunking')).toHaveValue('word')
    expect(screen.getByTestId('mock-llm-interval')).toHaveValue(50)
    expect(screen.getByTestId('mock-llm-stop-reason')).toHaveValue('stop')
    expect(screen.getByTestId('mock-llm-usage')).toHaveValue('auto')
    expect(screen.queryByTestId('mock-llm-usage-in')).toBeNull()
    expect(screen.getByTestId('mock-llm-hint')).toHaveTextContent('time to first token')
    expect(screen.getByTestId('mock-llm-hint')).toHaveTextContent('{{lastToolResult}}')
    expect(screen.queryByTestId('mock-llm-anthropic-hint')).toBeNull()

    fireEvent.change(screen.getByTestId('mock-llm-provider'), { target: { value: 'anthropic' } })
    await waitFor(() =>
      expect(httpBridge.response.update).toHaveBeenLastCalledWith('r-1', {
        streamConfig: { ...LLM_DEFAULTS, chunkIntervalMs: 50, provider: 'anthropic' },
      }),
    )
    const hint = await screen.findByTestId('mock-llm-anthropic-hint')
    expect(hint).toHaveTextContent('saved Anthropic key')
    // PM review #19: the note names both paths — Open in AI Chat never sends
    // the saved key; a tab set up by hand on the Anthropic provider does.
    expect(hint).toHaveTextContent(/Open in AI Chat \(Anthropic\).{0,3} never sends your saved/)
    expect(hint).toHaveTextContent(/yourself, on the Anthropic provider, does send your saved key/)

    fireEvent.change(screen.getByTestId('mock-llm-usage'), { target: { value: 'custom' } })
    await waitFor(() =>
      expect(httpBridge.response.update).toHaveBeenLastCalledWith('r-1', {
        streamConfig: expect.objectContaining({ usage: { inputTokens: 0, outputTokens: 0 } }),
      }),
    )
    expect(await screen.findByTestId('mock-llm-usage-in')).toHaveValue(0)
    expect(screen.getByTestId('mock-llm-usage-out')).toHaveValue(0)
  })

  it('tool calls: invalid JSON shows a red line and is not saved; a valid list is saved', async () => {
    await mount(AI_SERVER, { endpoints: [CHAT_EP], responses: [llm()] })
    const box = screen.getByTestId('mock-llm-tool-calls')
    expect(box).toHaveValue('')
    fireEvent.change(box, { target: { value: '[{"name": "echo",' } })
    fireEvent.blur(box)
    const err = await screen.findByTestId('mock-llm-tool-calls-error')
    expect(err).toHaveAttribute('role', 'alert')
    expect(httpBridge.response.update).not.toHaveBeenCalled()

    fireEvent.change(box, { target: { value: '{"name": "echo"}' } })
    fireEvent.blur(box)
    await waitFor(() =>
      expect(screen.getByTestId('mock-llm-tool-calls-error')).toHaveTextContent('JSON list'),
    )
    expect(httpBridge.response.update).not.toHaveBeenCalled()

    fireEvent.change(box, {
      target: { value: '[{"name": "echo", "arguments": {"text": "hi"}}]' },
    })
    fireEvent.blur(box)
    await waitFor(() =>
      expect(httpBridge.response.update).toHaveBeenLastCalledWith('r-1', {
        streamConfig: {
          ...LLM_DEFAULTS,
          // The engine always stops with tool_calls when there are calls — stored so.
          stopReason: 'tool_calls',
          toolCalls: [{ name: 'echo', arguments: { text: 'hi' } }],
        },
      }),
    )
    expect(screen.queryByTestId('mock-llm-tool-calls-error')).toBeNull()
    // …and the Stop reason select says so, disabled with the reason.
    await waitFor(() => expect(screen.getByTestId('mock-llm-stop-reason')).toBeDisabled())
    expect(screen.getByTestId('mock-llm-stop-reason')).toHaveValue('tool_calls')
    expect(screen.getByTestId('mock-llm-stop-reason-reason')).toHaveTextContent('Tool calls')

    // Clearing the list goes back to a text reply that stops normally.
    fireEvent.change(screen.getByTestId('mock-llm-tool-calls'), { target: { value: '' } })
    fireEvent.blur(screen.getByTestId('mock-llm-tool-calls'))
    await waitFor(() =>
      expect(httpBridge.response.update).toHaveBeenLastCalledWith('r-1', {
        streamConfig: LLM_DEFAULTS,
      }),
    )
  })

  it('a rejected LLM setting is shown (translated), not swallowed', async () => {
    await mount(AI_SERVER, {
      endpoints: [CHAT_EP],
      responses: [llm()],
      failResponseUpdate: 'Stop reason "tool_calls" needs at least one tool call',
    })
    fireEvent.change(screen.getByTestId('mock-llm-stop-reason'), {
      target: { value: 'tool_calls' },
    })
    const alert = await screen.findByTestId('mock-llm-error')
    expect(alert).toHaveAttribute('role', 'alert')
    expect(alert).toHaveTextContent('Stop reason "Tool calls" needs at least one tool call')
  })

  it('engine LLM-setting errors map to both locales (anchored: no prefix mix-up)', () => {
    expect(translateStreamError('Tool call 2: arguments must be a JSON object')).toBe(
      'Tool call 2: arguments must be a JSON object',
    )
    setLocale('tr')
    expect(translateStreamError('Unknown LLM setting: ttftMs')).toBe('Bilinmeyen LLM ayarı: ttftMs')
    expect(translateStreamError('Tool call 2: arguments must be a JSON object')).toBe(
      'Araç çağrısı 2: argümanlar bir JSON nesnesi olmalı',
    )
    expect(translateStreamError('Tool call 2: arguments must be a JSON object or JSON text')).toBe(
      'Araç çağrısı 2: argümanlar bir JSON nesnesi ya da JSON metni olmalı',
    )
    expect(
      translateStreamError(
        'Chunk interval must be a whole number of milliseconds between 0 and 10000',
      ),
    ).toBe('Parça aralığı 0 ile 10000 arasında tam sayı (ms) olmalı')
    expect(translateStreamError('Stop reason "tool_calls" needs at least one tool call')).toBe(
      'Durma nedeni "Araç çağrıları" en az bir araç çağrısı ister',
    )
  })

  it('body-type switch writes the new type’s fresh settings in the same update (AI: json → llm → json)', async () => {
    await mount(AI_SERVER, {
      endpoints: [CHAT_EP],
      responses: [httpResponse({ bodyType: 'json', streamConfig: null })],
    })
    const select = screen.getByTestId('mock-response-body-type')
    fireEvent.change(select, { target: { value: 'llm' } })
    await waitFor(() => expect(httpBridge.response.update).toHaveBeenCalledTimes(1))
    expect(httpBridge.response.update).toHaveBeenLastCalledWith('r-1', {
      bodyType: 'llm',
      streamConfig: LLM_DEFAULTS,
    })
    await screen.findByTestId('mock-llm-options')

    fireEvent.change(select, { target: { value: 'json' } })
    await waitFor(() => expect(httpBridge.response.update).toHaveBeenCalledTimes(2))
    expect(httpBridge.response.update).toHaveBeenLastCalledWith('r-1', {
      bodyType: 'json',
      streamConfig: null,
    })
    await waitFor(() => expect(screen.queryByTestId('mock-llm-options')).toBeNull())
  })

  it('body-type switch on an SSE server: an LLM leftover is replaced by fresh stream settings', async () => {
    await mount(httpServer({ id: 'srv-1', kind: 'sse' }), {
      endpoints: [httpEndpoint({ serverId: 'srv-1' })],
      // A response another build left as llm, with llm settings in the column.
      responses: [llm()],
    })
    const select = screen.getByTestId('mock-response-body-type')
    fireEvent.change(select, { target: { value: 'sse' } })
    await waitFor(() => expect(httpBridge.response.update).toHaveBeenCalledTimes(1))
    expect(httpBridge.response.update).toHaveBeenLastCalledWith('r-1', {
      bodyType: 'sse',
      streamConfig: SSE_DEFAULTS,
    })
    await screen.findByTestId('mock-sse-options')
    fireEvent.change(select, { target: { value: 'text' } })
    await waitFor(() => expect(httpBridge.response.update).toHaveBeenCalledTimes(2))
    expect(httpBridge.response.update).toHaveBeenLastCalledWith('r-1', {
      bodyType: 'text',
      streamConfig: null,
    })
  })

  it('AI "Add": POST /v1/chat/completions (llm openai), then /v1/messages (anthropic), then /new-endpoint', async () => {
    await mount(AI_SERVER)
    const add = async (): Promise<void> => {
      await act(async () => {
        fireEvent.click(screen.getByTestId('mock-add-endpoint'))
      })
    }
    await add()
    await waitFor(() => expect(httpBridge.response.create).toHaveBeenCalledTimes(1))
    expect(httpBridge.endpoint.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ method: 'POST', path: '/v1/chat/completions', pathMode: 'exact' }),
    )
    expect(httpBridge.response.create).toHaveBeenLastCalledWith(
      expect.objectContaining({
        bodyType: 'llm',
        body: 'Hello from the mock LLM. You said: {{lastUserMessage}}',
        streamConfig: LLM_DEFAULTS,
      }),
    )
    await add()
    await waitFor(() => expect(httpBridge.response.create).toHaveBeenCalledTimes(2))
    expect(httpBridge.endpoint.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ method: 'POST', path: '/v1/messages' }),
    )
    expect(httpBridge.response.create).toHaveBeenLastCalledWith(
      expect.objectContaining({
        bodyType: 'llm',
        streamConfig: { ...LLM_DEFAULTS, provider: 'anthropic' },
      }),
    )
    await add()
    await waitFor(() => expect(httpBridge.endpoint.create).toHaveBeenCalledTimes(3))
    expect(httpBridge.endpoint.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ method: 'POST', path: '/new-endpoint' }),
    )
    // The plain fallback gets no canned reply.
    expect(httpBridge.response.create).toHaveBeenCalledTimes(2)
  })

  it('LLM cURL: the copy button puts an OpenAI streaming chat request on the clipboard', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    await mount(AI_SERVER, { endpoints: [CHAT_EP], responses: [llm()] })
    fireEvent.click(screen.getByTestId('mock-copy-curl'))
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    expect(writeText.mock.calls[0][0]).toBe(
      "curl -N 'http://127.0.0.1:3300/v1/chat/completions' \\\n" +
        "  -H 'content-type: application/json' \\\n" +
        `  -d '{"model":"mock-model","stream":true,"messages":[{"role":"user","content":"Hello"}]}'`,
    )
  })

  it('LLM cURL (Anthropic) adds anthropic-version and max_tokens; non-LLM keeps the old cURL', () => {
    const server = httpServer({ port: 3300 })
    const ep = httpEndpoint({ method: 'POST', path: '/v1/messages' })
    expect(buildMockCurl(server, ep, 'anthropic')).toBe(
      "curl -N 'http://127.0.0.1:3300/v1/messages' \\\n" +
        "  -H 'content-type: application/json' \\\n" +
        "  -H 'anthropic-version: 2023-06-01' \\\n" +
        `  -d '{"model":"mock-model","stream":true,"max_tokens":256,"messages":[{"role":"user","content":"Hello"}]}'`,
    )
    expect(buildMockCurl(server, ep, null)).toBe(
      "curl -X POST 'http://127.0.0.1:3300/v1/messages' \\\n" +
        "  -H 'Content-Type: application/json' \\\n" +
        "  -d '{}'",
    )
  })
})
