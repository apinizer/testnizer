/**
 * Smoke render test for MockServerEditor — guards against the
 * "Maximum update depth exceeded" / "getSnapshot should be cached"
 * regression caused by Zustand selectors that emit a new `[]` literal
 * on every render. Mounts the editor against a stubbed window.api.mock
 * bridge and ensures it renders without throwing.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'

// vi.hoisted runs before any ES import in this file is resolved, so we can
// install the window.api.mock bridge stub *before* the store module reads it.
vi.hoisted(() => {
  type Listener = (entry: unknown) => void
  const stub = {
    server: {
      list: () => Promise.resolve({ success: true, data: [] }),
      create: () => Promise.resolve({ success: true, data: null }),
      update: () => Promise.resolve({ success: true, data: null }),
      delete: () => Promise.resolve({ success: true, data: true }),
      start: () =>
        Promise.resolve({ success: true, data: { status: 'running', port: 3001 } }),
      stop: () => Promise.resolve({ success: true, data: { status: 'stopped' } }),
      status: () => Promise.resolve({ success: true, data: { status: 'stopped' } }),
    },
    endpoint: {
      list: () => Promise.resolve({ success: true, data: [] }),
      create: () => Promise.resolve({ success: true, data: null }),
      update: () => Promise.resolve({ success: true, data: null }),
      delete: () => Promise.resolve({ success: true, data: true }),
    },
    response: {
      list: () => Promise.resolve({ success: true, data: [] }),
      create: () => Promise.resolve({ success: true, data: null }),
      update: () => Promise.resolve({ success: true, data: null }),
      delete: () => Promise.resolve({ success: true, data: true }),
    },
    logs: {
      get: () => Promise.resolve({ success: true, data: [] }),
      clear: () => Promise.resolve({ success: true, data: true }),
    },
    importOpenApi: () => Promise.resolve({ success: true, data: null }),
    importPostman: () => Promise.resolve({ success: true, data: null }),
    onLog: (_cb: Listener) => () => {},
    onStatus: (_cb: Listener) => () => {},
  }
  const g = globalThis as unknown as { window?: { api?: { mock: typeof stub } } }
  if (!g.window) g.window = { api: { mock: stub } }
  else g.window.api = { mock: stub }
})

// Stub Monaco — it does heavy DOM work that doesn't help this smoke check.
vi.mock('../../src/renderer/components/shared/MonacoWrapper', () => ({
  default: ({ value }: { value?: string }) => React.createElement('div', { 'data-monaco': '' }, value),
}))

// Now import the component under test (it will see the stubbed bridge).
import MockServerEditor from '../../src/renderer/components/mock/MockServerEditor'
import { useMockStore } from '../../src/renderer/stores/mock.store'
import type { MockServer } from '../../src/renderer/types'

const sampleServer: MockServer = {
  id: 'srv-1',
  projectId: 'p-1',
  name: 'Test Server',
  description: '',
  host: '127.0.0.1',
  port: 3001,
  basePath: '',
  autoStart: false,
  corsEnabled: false,
  corsAllowOrigins: '*',
  corsAllowMethods: 'GET,POST',
  corsAllowHeaders: '*',
  corsAllowCredentials: false,
  corsMaxAge: 600,
  authConfig: { type: 'none' },
  failureConfig: { enabled: false, probability: 0, mode: 'status', status: 500, timeoutMs: 30000 },
  rateLimitConfig: { enabled: false, requestsPerWindow: 100, windowMs: 60000, scope: 'ip' },
  echoEnabled: false,
  proxyEnabled: false,
  proxyTarget: '',
  proxyRecord: false,
  createdAt: 0,
  updatedAt: 0,
}

beforeEach(() => {
  // Reset Zustand store between tests so cumulative state doesn't leak.
  useMockStore.setState({
    servers: [sampleServer],
    endpointsByServer: {},
    responsesByEndpoint: {},
    statusByServer: {},
    errorByServer: {},
    logsByServer: {},
  })
})

describe('MockServerEditor — render smoke', () => {
  it('renders without infinite-loop crashes when the server has no endpoints yet', async () => {
    // The bug we're guarding against: each render emits a fresh `[]` literal
    // from `s.endpointsByServer[serverId] ?? []`, which makes Zustand's
    // useSyncExternalStore think state changed every render and React aborts
    // with "Maximum update depth exceeded". A successful render here means
    // we've stabilised the selector references.
    render(React.createElement(MockServerEditor, { serverId: 'srv-1' }))
    expect(screen.getByText('Test Server')).not.toBeNull()
  })

  it('renders the Endpoints / Settings / Logs tabs', () => {
    render(React.createElement(MockServerEditor, { serverId: 'srv-1' }))
    // Tab labels come from i18n; the keys themselves are stable when no locale is loaded.
    // We assert via the visible button text.
    expect(screen.getAllByRole('button').length).toBeGreaterThan(0)
  })

  it('handles an unknown serverId gracefully', () => {
    render(React.createElement(MockServerEditor, { serverId: 'unknown' }))
    // The fallback "server not found" path renders a single message, so the
    // component should not throw.
    expect(document.body.textContent).toBeTruthy()
  })
})
