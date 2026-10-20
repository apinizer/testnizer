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
