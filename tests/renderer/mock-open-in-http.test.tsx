/**
 * Mock endpoint URL bar — "Open" (system browser, GET only, no headers / body /
 * auth) is replaced by "Open in request tab": a normal HTTP request tab,
 * prefilled with the endpoint's method, the mock URL and the headers / JSON
 * body the cURL copy carries, sent at once when the server runs — so any method
 * can be tried in-app and then Saved like any request. Mirrors the "Open in SSE
 * tab" sibling: one tab per endpoint (a second click focuses it), "<name> ·
 * client" title, stopped → "Start & open …".
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
vi.mock('../../src/renderer/lib/toast', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}))

import MockServerEditor from '../../src/renderer/components/mock/MockServerEditor'
import { useMockStore } from '../../src/renderer/stores/mock.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useRequestStore } from '../../src/renderer/stores/request.store'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import { buildMockCurl, mockRequestShape } from '../../src/renderer/components/mock/mock-curl'
import type { MockEndpoint, MockServer } from '../../src/renderer/types'

const SERVER = httpServer({
  id: 'srv-h',
  kind: 'http',
  port: 3300,
  name: 'Orders',
  basePath: '/api',
})

const sendRequest = vi.fn(() => Promise.resolve())

async function mount(
  endpoint: MockEndpoint,
  status?: 'running',
  server: MockServer = SERVER,
  reply: Parameters<typeof httpResponse>[0] = { bodyType: 'json', body: '{"ok":true}' },
): Promise<void> {
  resetHttpBridge([server])
  seedHttpBridge({
    endpoints: [endpoint],
    responses: [httpResponse({ endpointId: endpoint.id, ...reply })],
  })
  useMockStore.setState({
    servers: [server],
    endpointsByServer: {},
    responsesByEndpoint: {},
    statusByServer: status ? { [server.id]: status } : {},
    errorByServer: {},
    logsByServer: {},
  })
  useTabsStore.setState({ tabs: [], activeTabId: null })
  render(React.createElement(MockServerEditor, { serverId: server.id }))
  await screen.findByTestId('mock-endpoint-open-in-http')
}

const httpTabs = () => useTabsStore.getState().tabs.filter((t) => t.protocol === 'http')

beforeEach(() => {
  useUIStore.getState().setLocale('en')
  sendRequest.mockClear()
  useRequestStore.setState({ sendRequest })
})
afterEach(() => {
  cleanup()
  useUIStore.getState().setLocale('en')
})

describe('mock endpoint URL bar — Open in request tab', () => {
  it('no system-browser "Open" button is left in the URL bar', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    await mount(httpEndpoint({ id: 'ep-get', serverId: 'srv-h', path: '/orders' }), 'running')
    const actions = screen.getByTestId('mock-endpoint-url-actions')
    const labels = Array.from(actions.querySelectorAll('button')).map((b) =>
      (b.textContent ?? '').replace(/[↗⧉✓]/g, '').trim(),
    )
    expect(labels).not.toContain('Open')
    expect(labels).toContain('Open in request tab')
    fireEvent.click(screen.getByTestId('mock-endpoint-open-in-http'))
    expect(open).not.toHaveBeenCalled()
    open.mockRestore()
  })

  it('GET: opens an HTTP tab with the method and mock URL and sends it', async () => {
    await mount(httpEndpoint({ id: 'ep-get', serverId: 'srv-h', path: '/orders' }), 'running')
    const btn = screen.getByTestId('mock-endpoint-open-in-http')
    expect(btn).toHaveTextContent('Open in request tab')
    await act(async () => {
      fireEvent.click(btn)
    })
    await waitFor(() => expect(httpTabs()).toHaveLength(1))
    const tab = httpTabs()[0]
    expect(tab).toMatchObject({
      name: 'Orders · client',
      method: 'GET',
      url: 'http://127.0.0.1:3300/api/orders',
      isDirty: false,
    })
    expect(useTabsStore.getState().activeTabId).toBe(tab.id)
    const req = useRequestStore.getState()
    expect(req.method).toBe('GET')
    expect(req.url).toBe('http://127.0.0.1:3300/api/orders')
    expect(req.headers).toEqual([])
    expect(req.body).toEqual({ type: 'none' })
    // Not `inherit`: the tab sends on its own, so the project's real auth must
    // not reach the mock unasked (AI Chat twin: `savedKeyDisabled`).
    expect(req.auth).toEqual({ type: 'none' })
    expect(sendRequest).toHaveBeenCalledTimes(1)
    expect(httpBridge.server.start).not.toHaveBeenCalled()
  })

  it('POST: method, JSON header and body come from the same shape as the cURL copy', async () => {
    const ep = httpEndpoint({ id: 'ep-post', serverId: 'srv-h', method: 'POST', path: '/orders' })
    await mount(ep, 'running')
    await act(async () => {
      fireEvent.click(screen.getByTestId('mock-endpoint-open-in-http'))
    })
    await waitFor(() => expect(httpTabs()).toHaveLength(1))
    expect(httpTabs()[0]).toMatchObject({ method: 'POST' })
    const req = useRequestStore.getState()
    expect(req.method).toBe('POST')
    expect(req.headers.map((h) => [h.key, h.value, h.enabled])).toEqual([
      ['Content-Type', 'application/json', true],
    ])
    expect(req.body).toEqual({ type: 'json', content: '{}' })
    expect(sendRequest).toHaveBeenCalledTimes(1)
    // The cURL copy and the tab are the same request.
    const shape = mockRequestShape(ep, null)
    expect(buildMockCurl(SERVER, ep, null)).toContain(`-X ${shape.method}`)
  })

  it('a second click focuses the tab it opened — no duplicate, no second send', async () => {
    await mount(httpEndpoint({ id: 'ep-get', serverId: 'srv-h', path: '/orders' }), 'running')
    const btn = screen.getByTestId('mock-endpoint-open-in-http')
    await act(async () => {
      fireEvent.click(btn)
    })
    await waitFor(() => expect(httpTabs()).toHaveLength(1))
    const first = httpTabs()[0].id
    // Move away, then click again.
    useTabsStore.getState().openTab({ id: 'other', name: 'Other', protocol: 'http', url: '' })
    expect(useTabsStore.getState().activeTabId).toBe('other')
    await act(async () => {
      fireEvent.click(btn)
    })
    await waitFor(() => expect(useTabsStore.getState().activeTabId).toBe(first))
    expect(httpTabs().filter((t) => t.id.startsWith('mockclient-http-'))).toHaveLength(1)
    expect(sendRequest).toHaveBeenCalledTimes(1)
  })

  it('stopped: "Start & open in request tab" starts the server, then opens', async () => {
    await mount(httpEndpoint({ id: 'ep-get', serverId: 'srv-h', path: '/orders' }))
    const btn = screen.getByTestId('mock-endpoint-open-in-http')
    expect(btn).toHaveTextContent('Start & open in request tab')
    expect(btn).not.toBeDisabled()
    await act(async () => {
      fireEvent.click(btn)
    })
    await waitFor(() => expect(httpTabs()).toHaveLength(1))
    expect(httpBridge.server.start).toHaveBeenCalledWith('srv-h')
  })

  it(':param path opens with its path-variable rows and does not send a literal ":id"', async () => {
    await mount(
      httpEndpoint({ id: 'ep-p', serverId: 'srv-h', path: '/orders/:id', pathMode: 'param' }),
      'running',
    )
    await act(async () => {
      fireEvent.click(screen.getByTestId('mock-endpoint-open-in-http'))
    })
    await waitFor(() => expect(httpTabs()).toHaveLength(1))
    expect(useRequestStore.getState().pathVariables?.map((p) => p.key)).toEqual(['id'])
    expect(sendRequest).not.toHaveBeenCalled()
  })

  it('an endpoint with an SSE reply opens without sending — its stream may never end', async () => {
    await mount(
      httpEndpoint({ id: 'ep-s', serverId: 'srv-h', path: '/events' }),
      'running',
      httpServer({ id: 'srv-h', kind: 'sse', port: 3300, name: 'Ticker', basePath: '/api' }),
      { bodyType: 'sse', body: 'data: a\n' },
    )
    // Both clients are offered; only the SSE one connects on its own.
    expect(screen.getByTestId('mock-endpoint-open-in-sse')).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(screen.getByTestId('mock-endpoint-open-in-http'))
    })
    await waitFor(() => expect(httpTabs()).toHaveLength(1))
    expect(useRequestStore.getState().url).toBe('http://127.0.0.1:3300/api/events')
    expect(sendRequest).not.toHaveBeenCalled()
  })

  it('wildcard / regex path: disabled with the reason', async () => {
    await mount(
      httpEndpoint({ id: 'ep-w', serverId: 'srv-h', path: '/files/*', pathMode: 'wildcard' }),
      'running',
    )
    const btn = screen.getByTestId('mock-endpoint-open-in-http')
    expect(btn).toBeDisabled()
    expect(btn.getAttribute('title')).toMatch(/Wildcard and regex paths have no single URL/)
  })

  it('TR labels', async () => {
    useUIStore.getState().setLocale('tr')
    await mount(httpEndpoint({ id: 'ep-get', serverId: 'srv-h', path: '/orders' }))
    expect(screen.getByTestId('mock-endpoint-open-in-http')).toHaveTextContent(
      'Başlat ve istek sekmesinde aç',
    )
  })
})
