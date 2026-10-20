/**
 * Mock editor at a narrow window and at font size 16 (issue #226).
 *
 * jsdom has no layout engine, so these checks pin the CSS that makes the
 * rows fit — they do NOT measure anything:
 *
 *  - URL bar: the URL box keeps a minimum width and truncates (full URL in
 *    `title`); the buttons sit in their own group that wraps onto the next
 *    line as a whole, and no button label wraps inside itself.
 *  - Response row (status / name / body type / delete): grid tracks with
 *    fixed rem minimums (+ `min-w-0` controls) instead of `1fr`, whose
 *    `auto` minimum pushed the select and the delete button out of the editor.
 *  - Path mode row and the Stream / LLM option rows wrap; labels never break.
 *  - Number boxes (Delay, Priority, Stream, LLM) are sized in `rem`, which
 *    follows the app font size — the old 60 / 70 px clipped "15000" to
 *    "1500" at font size 16.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
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
  await screen.findByTestId('mock-response-body-type')
}

const SSE = httpServer({ id: 'srv-1', kind: 'sse', port: 3200, name: 'Live ticker' })
const AI = httpServer({ id: 'srv-1', kind: 'ai', port: 3300, name: 'Chat API' })
const sseResponse = httpResponse({
  bodyType: 'sse',
  body: 'id: 1\ndata: a\n',
  streamConfig: {
    intervalMs: 1000,
    heartbeatMs: 15000,
    loop: true,
    onEnd: 'keep-open',
    resume: false,
  },
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
    usage: { inputTokens: 10, outputTokens: 20 },
  } as MockResponse['streamConfig'],
})

/** Width of a number box in rem (0 when it is not a rem width). */
function remWidth(el: HTMLElement): number {
  const w = el.style.width
  return w.endsWith('rem') ? parseFloat(w) : 0
}

beforeEach(() => setLocale('en'))
afterEach(() => cleanup())

describe('URL bar at a narrow width (issue #226)', () => {
  it('SSE: the URL keeps a minimum width and truncates; the buttons wrap as one group, single-line', async () => {
    await mount(SSE, { endpoints: [httpEndpoint({ serverId: 'srv-1' })], responses: [sseResponse] })
    const bar = screen.getByTestId('mock-endpoint-url-bar')
    expect(bar).toHaveClass('flex-wrap')

    const box = screen.getByTestId('mock-endpoint-url-box')
    expect(box).toHaveClass('flex-1')
    expect(box.className).toMatch(/min-w-\[\d+(\.\d+)?rem\]/)
    const url = screen.getByTestId('mock-endpoint-url')
    expect(url).toHaveClass('truncate')
    expect(url).toHaveAttribute('title', 'http://127.0.0.1:3200/events')

    const actions = screen.getByTestId('mock-endpoint-url-actions')
    // Alone on its line the group may shrink to the bar, so its buttons wrap (never overflow).
    expect(actions).toHaveClass('flex-wrap', 'max-w-full', 'min-w-0')
    expect(actions).not.toHaveClass('shrink-0')
    const buttons = actions.querySelectorAll('button')
    expect(buttons.length).toBe(4) // Copy, cURL, Open, Start & open in SSE tab
    for (const b of buttons) expect(b).toHaveClass('whitespace-nowrap')
    expect(screen.getByTestId('mock-endpoint-open-in-sse').parentElement).toBe(actions)
    // The "server stopped" chip stays on one line too.
    expect(screen.getByTestId('mock-endpoint-not-running')).toHaveClass('whitespace-nowrap')
  })

  it('AI: same URL bar anatomy (no SSE button)', async () => {
    await mount(AI, {
      endpoints: [
        httpEndpoint({ serverId: 'srv-1', method: 'POST', path: '/v1/chat/completions' }),
      ],
      responses: [llmResponse],
    })
    expect(screen.getByTestId('mock-endpoint-url-bar')).toHaveClass('flex-wrap')
    expect(screen.getByTestId('mock-endpoint-url-actions').querySelectorAll('button').length).toBe(
      3,
    )
  })
})

describe('Response row and option rows at a narrow width (issue #226)', () => {
  it('the response row tracks can shrink; its controls have no intrinsic minimum', async () => {
    await mount(SSE, { endpoints: [httpEndpoint({ serverId: 'srv-1' })], responses: [sseResponse] })
    const row = screen.getByTestId('mock-response-row')
    // Fixed rem minimums on every track — never `1fr` (= `minmax(auto, 1fr)`).
    expect(row.className).toMatch(
      /grid-cols-\[minmax\([\d.]+rem,140px\)_minmax\([\d.]+rem,1fr\)_minmax\([\d.]+rem,140px\)_auto\]/,
    )
    for (const id of ['mock-response-status', 'mock-response-name', 'mock-response-body-type']) {
      expect(screen.getByTestId(id)).toHaveClass('min-w-0', 'w-full')
    }
    expect(screen.getByTestId('mock-response-delete')).toHaveAttribute('aria-label')
  })

  it('the path-mode row wraps and its labels do not break', async () => {
    await mount(SSE, { endpoints: [httpEndpoint({ serverId: 'srv-1' })], responses: [sseResponse] })
    const row = screen.getByTestId('mock-endpoint-options-row')
    expect(row).toHaveClass('flex-wrap')
    for (const label of row.querySelectorAll('label'))
      expect(label).toHaveClass('whitespace-nowrap')
  })

  it('Stream row: number labels are flex rows that do not break', async () => {
    await mount(SSE, { endpoints: [httpEndpoint({ serverId: 'srv-1' })], responses: [sseResponse] })
    const label = screen.getByTestId('mock-stream-interval').closest('label')!
    expect(label).toHaveClass('flex', 'items-center', 'whitespace-nowrap')
  })
})

describe('Number boxes at font size 16 (issue #226)', () => {
  it('Stream interval / heartbeat, Delay and Priority are rem-sized for 6 digits', async () => {
    await mount(SSE, { endpoints: [httpEndpoint({ serverId: 'srv-1' })], responses: [sseResponse] })
    for (const id of [
      'mock-stream-interval',
      'mock-stream-heartbeat',
      'mock-response-delay',
      'mock-endpoint-priority',
    ]) {
      expect(remWidth(screen.getByTestId(id)), id).toBeGreaterThanOrEqual(6.5)
    }
  })

  it('LLM chunk interval is rem-sized; usage token boxes fit 8 digits (max 10 000 000)', async () => {
    await mount(AI, {
      endpoints: [
        httpEndpoint({ serverId: 'srv-1', method: 'POST', path: '/v1/chat/completions' }),
      ],
      responses: [llmResponse],
    })
    expect(remWidth(screen.getByTestId('mock-llm-interval'))).toBeGreaterThanOrEqual(6.5)
    for (const id of ['mock-llm-usage-in', 'mock-llm-usage-out']) {
      expect(remWidth(screen.getByTestId(id)), id).toBeGreaterThan(
        remWidth(screen.getByTestId('mock-llm-interval')),
      )
    }
  })
})
