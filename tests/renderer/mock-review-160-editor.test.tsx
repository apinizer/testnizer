/**
 * PM review 1.6.0 — mock editor findings #4, #17, #18 (+ the body-type
 * labels of #21).
 *
 * jsdom has no layout engine: the header / field checks pin the CSS contract
 * that makes the rows wrap at 1024 px, font 16 and Turkish — they do not
 * measure anything (the live 1024×700 sweep does).
 *
 *  - #4: the editor header wraps (title block with a rem minimum, actions in
 *    their own wrapping group, the name truncates with its full text in
 *    `title`, no button label breaks inside its fixed-height button).
 *  - #17: on SSE / AI servers the request checks (auth override, JSON schema
 *    validation) are behind a "Request checks" link while unset — the engine
 *    applies them on every kind, so they stay reachable and are shown when
 *    set; "Fill from Security / keystore" (JWKS) is HTTP-only.
 *  - #18: the mid-stream error Message and the SSE error Data take the rest
 *    of the row; the placeholder / value is in `title`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import React from 'react'
// Must come first: installs window.api.mock before mock.store captures it at import.
import {
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
import { setLocale } from '../../src/renderer/lib/i18n'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import type { MockEndpoint, MockResponse, MockServer } from '../../src/renderer/types'

async function mount(
  server: MockServer,
  data: { endpoints: MockEndpoint[]; responses: MockResponse[] },
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
  render(React.createElement(MockServerEditor, { serverId: server.id }))
  await screen.findByTestId('mock-endpoint-path')
  if (data.responses.length) await screen.findByTestId('mock-response-body-type')
}

const HTTP = httpServer({ id: 'srv-1', kind: 'http', port: 3100, name: 'Orders' })
const SSE = httpServer({ id: 'srv-1', kind: 'sse', port: 3200, name: 'Live ticker' })
const AI = httpServer({
  id: 'srv-1',
  kind: 'ai',
  port: 3300,
  name: 'A rather long AI mock server name for a narrow window',
})
const CHAT_EP = httpEndpoint({ serverId: 'srv-1', method: 'POST', path: '/v1/chat/completions' })
const jsonResponse = httpResponse({ bodyType: 'json', body: '{}', streamConfig: null })
const sseResponse = httpResponse({
  bodyType: 'sse',
  body: 'id: 1\ndata: a\n',
  streamConfig: {
    intervalMs: 1000,
    heartbeatMs: 15000,
    loop: true,
    onEnd: 'keep-open',
    resume: false,
    errorEvent: { afterEvents: 3, data: '{"error":"Mock stream error"}' },
  } as MockResponse['streamConfig'],
})
const llmResponse = httpResponse({
  bodyType: 'llm',
  body: 'Hello',
  streamConfig: {
    provider: 'openai',
    chunking: 'word',
    chunkIntervalMs: 30,
    stopReason: 'stop',
    toolCalls: [],
    usage: 'auto',
    streamError: { afterChunks: 3 },
  } as MockResponse['streamConfig'],
})

beforeEach(() => setLocale('en'))
afterEach(() => {
  cleanup()
  useUIStore.setState({ locale: 'en' })
  setLocale('en')
})

describe('#4 editor header wraps in a narrow window', () => {
  it('title block keeps a rem minimum; actions wrap as their own group; name truncates with title', async () => {
    await mount(AI, { endpoints: [CHAT_EP], responses: [llmResponse] })
    const header = screen.getByTestId('mock-header')
    expect(header).toHaveClass('flex-wrap')
    const actions = screen.getByTestId('mock-header-actions')
    expect(actions).toHaveClass('flex-wrap', 'min-w-0', 'max-w-full')
    expect(actions).not.toHaveClass('shrink-0')
    const titleBlock = header.firstElementChild as HTMLElement
    expect(titleBlock.className).toMatch(/min-w-\[min\(100%,\d+rem\)\]/)
    const name = screen.getByTestId('mock-header-name')
    expect(name).toHaveClass('truncate', 'min-w-0')
    expect(name).toHaveAttribute('title', AI.name)
    // Fixed-height buttons: a label never wraps inside (TR "Başlat ve AI Chat sekmesinde aç").
    for (const b of actions.querySelectorAll('button')) expect(b).toHaveClass('whitespace-nowrap')
    expect(screen.getByTestId('mock-status')).toHaveClass('whitespace-nowrap')
  })

  it('Turkish: same anatomy, Turkish labels', async () => {
    useUIStore.setState({ locale: 'tr' })
    await mount(AI, { endpoints: [CHAT_EP], responses: [llmResponse] })
    expect(screen.getByTestId('mock-header-actions')).toHaveTextContent(
      'Başlat ve AI Chat sekmesinde aç',
    )
  })
})

describe('#17 HTTP-only blocks on SSE / AI endpoints', () => {
  it('HTTP: auth override and schema validation are shown as before', async () => {
    await mount(HTTP, { endpoints: [httpEndpoint({ serverId: 'srv-1' })], responses: [] })
    expect(screen.getByText(/Auth Override/)).toBeInTheDocument()
    expect(screen.getByText(/JSON Schema Validation/)).toBeInTheDocument()
    expect(screen.queryByTestId('mock-endpoint-request-checks-toggle')).toBeNull()
  })

  for (const [label, server] of [
    ['SSE', SSE],
    ['AI', AI],
  ] as const) {
    it(`${label}: unset → behind "Request checks", which opens them`, async () => {
      await mount(server, {
        endpoints: [httpEndpoint({ serverId: 'srv-1' })],
        responses: [],
      })
      expect(screen.queryByText(/Auth Override/)).toBeNull()
      expect(screen.queryByText(/JSON Schema Validation/)).toBeNull()
      const toggle = screen.getByTestId('mock-endpoint-request-checks-toggle')
      expect(toggle).toHaveAttribute('aria-expanded', 'false')
      fireEvent.click(toggle)
      expect(toggle).toHaveAttribute('aria-expanded', 'true')
      expect(screen.getByText(/Auth Override/)).toBeInTheDocument()
      expect(screen.getByText(/JSON Schema Validation/)).toBeInTheDocument()
    })

    it(`${label}: a rule the engine enforces is never hidden`, async () => {
      await mount(server, {
        endpoints: [
          httpEndpoint({
            serverId: 'srv-1',
            authOverride: { type: 'none' } as MockEndpoint['authOverride'],
          }),
        ],
        responses: [],
      })
      expect(screen.getByText(/Auth Override/)).toBeInTheDocument()
      expect(screen.queryByTestId('mock-endpoint-request-checks-toggle')).toBeNull()
    })
  }

  it('JWKS fill on a JSON response: HTTP only', async () => {
    await mount(HTTP, {
      endpoints: [httpEndpoint({ serverId: 'srv-1' })],
      responses: [jsonResponse],
    })
    expect(screen.getByTestId('mock-jwks-fill')).toBeInTheDocument()
    cleanup()
    await mount(AI, { endpoints: [CHAT_EP], responses: [jsonResponse] })
    expect(screen.queryByTestId('mock-jwks-fill')).toBeNull()
    cleanup()
    await mount(SSE, {
      endpoints: [httpEndpoint({ serverId: 'srv-1' })],
      responses: [jsonResponse],
    })
    expect(screen.queryByTestId('mock-jwks-fill')).toBeNull()
  })
})

describe('#18 free-text fields get room', () => {
  it('LLM mid-stream error Message grows; the default is in the placeholder and title', async () => {
    await mount(AI, { endpoints: [CHAT_EP], responses: [llmResponse] })
    const input = screen.getByTestId('mock-llm-stream-error-message') as HTMLInputElement
    expect(input).toHaveClass('flex-1')
    expect(input.style.width).toBe('')
    const label = input.closest('label')!
    expect(label).toHaveAttribute('data-grow', 'true')
    expect(label).toHaveClass('flex-1')
    expect(input.placeholder).toMatch(/^The server had an error/)
    expect(input).toHaveAttribute('title', input.placeholder)
    // The type box keeps its fixed width.
    expect((screen.getByTestId('mock-llm-stream-error-type') as HTMLInputElement).style.width).toBe(
      '10rem',
    )
  })

  it('SSE error event Data grows and shows the full value on hover', async () => {
    await mount(SSE, { endpoints: [httpEndpoint({ serverId: 'srv-1' })], responses: [sseResponse] })
    const input = screen.getByTestId('mock-sse-error-event-data') as HTMLInputElement
    expect(input).toHaveClass('flex-1')
    expect(input.closest('label')).toHaveAttribute('data-grow', 'true')
    expect(input).toHaveAttribute('title', '{"error":"Mock stream error"}')
  })

  it('response row: status capped, name gets the rest; body types by label', async () => {
    await mount(AI, { endpoints: [CHAT_EP], responses: [llmResponse] })
    expect(screen.getByTestId('mock-response-row').className).toMatch(
      /grid-cols-\[minmax\(4\.5rem,6rem\)_minmax\(7rem,1fr\)_minmax\(7rem,10rem\)_auto\]/,
    )
    const select = screen.getByTestId('mock-response-body-type')
    const texts = within(select)
      .getAllByRole('option')
      .map((o) => o.textContent)
    expect(texts).toEqual(['AI reply', 'JSON'])
    expect(select).toHaveValue('llm')
  })
})
