/**
 * Mock editor Logs tab — one row per SSE / AI stream (issue #226).
 *
 * The main process writes TWO log entries for a stream: one when it opens and
 * one when it ends, linked by `x-mock-stream-id` (`src/main/mock/server.ts`).
 * The Logs list shows ONE row per stream: while only the open entry exists the
 * row says it is still streaming; the closed entry then replaces it in place
 * (same row id, so a selected row stays selected). A request without a stream
 * id — the refused 204 reconnect — is its own row. The collapse runs on the
 * live events AND on the list loaded from main (Refresh / reopen), which still
 * holds both raw entries.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, act, within, fireEvent } from '@testing-library/react'
import React from 'react'
// Must come first: installs window.api.mock before mock.store captures it at import.
import { httpBridge, httpServer, resetHttpBridge } from './mock-http-bridge-stub'

vi.mock('../../src/renderer/components/shared/MonacoWrapper', () => ({
  default: ({ value }: { value?: string }) =>
    React.createElement('div', { 'data-monaco': '' }, value),
}))

import MockServerEditor from '../../src/renderer/components/mock/MockServerEditor'
import { useMockStore } from '../../src/renderer/stores/mock.store'
import { setLocale } from '../../src/renderer/lib/i18n'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import { collapseStreamLogs } from '../../src/renderer/lib/mock-log-streams'
import type { MockLogEntry } from '../../src/renderer/types'

// The store subscribes to `api.mock.onLog` once, at import.
const emit = httpBridge.onLog.mock.calls[0]?.[0] as unknown as
  | ((entry: MockLogEntry) => void)
  | undefined

function entry(over: Partial<MockLogEntry> & { headers?: Record<string, string> }): MockLogEntry {
  const { headers, ...rest } = over
  return {
    id: 'l-1',
    serverId: 'srv-1',
    ts: 1_000,
    method: 'GET',
    path: '/events',
    query: '',
    statusCode: 200,
    latencyMs: 0,
    matchedEndpointId: null,
    matchedResponseId: null,
    request: { headers: {}, body: '' },
    response: { headers: headers ?? {}, body: '' },
    error: null,
    ...rest,
  }
}

const OPEN = entry({
  id: 'open-1',
  ts: 1_000,
  latencyMs: 0,
  headers: { 'x-mock-stream': 'open', 'x-mock-stream-id': 's-1' },
})
const CLOSED = entry({
  id: 'closed-1',
  ts: 3_000,
  latencyMs: 2023,
  headers: { 'x-mock-stream': 'frames=5;reason=end', 'x-mock-stream-id': 's-1' },
  response: {
    headers: { 'x-mock-stream': 'frames=5;reason=end', 'x-mock-stream-id': 's-1' },
    body: 'id: 1\n… (stream: 5 frames, 2.0 s, ended by the server)',
  },
})
const RECONNECT = entry({ id: 'r-204', ts: 4_000, statusCode: 204, latencyMs: 1 })

async function openLogs(): Promise<void> {
  const server = httpServer({ id: 'srv-1', kind: 'sse', name: 'Replay feed' })
  resetHttpBridge([server])
  useMockStore.setState({
    servers: [server],
    endpointsByServer: {},
    responsesByEndpoint: {},
    statusByServer: {},
    errorByServer: {},
    logsByServer: {},
  })
  render(React.createElement(MockServerEditor, { serverId: 'srv-1' }))
  fireEvent.click(screen.getByTestId('mock-tab-logs'))
  // Let the tab's own `loadLogs` (stub: empty list) land before live events.
  await act(async () => {
    await Promise.resolve()
  })
}

const rows = (): HTMLElement[] => screen.queryAllByTestId('mock-log-row')

beforeEach(() => {
  setLocale('en')
  useUIStore.setState({ locale: 'en' })
})
afterEach(() => {
  cleanup()
  httpBridge.logs.get.mockImplementation(() =>
    Promise.resolve({ success: true as const, data: [] }),
  )
})

describe('collapseStreamLogs', () => {
  it('open + closed with the same stream id → one row with the open row id/time and the closed data', () => {
    const out = collapseStreamLogs([OPEN, CLOSED, RECONNECT])
    expect(out).toHaveLength(2)
    expect(out[0].id).toBe('open-1')
    expect(out[0].ts).toBe(1_000)
    expect(out[0].latencyMs).toBe(2023)
    expect(out[0].response.body).toContain('5 frames')
    expect(out[1].id).toBe('r-204')
  })

  it('a resumed open tag (open;resumeAt=N) is an open entry too', () => {
    const resumed = entry({
      id: 'o2',
      headers: { 'x-mock-stream': 'open;resumeAt=3', 'x-mock-stream-id': 's-2' },
    })
    const closed = entry({
      id: 'c2',
      latencyMs: 9,
      headers: { 'x-mock-stream': 'frames=2;reason=client', 'x-mock-stream-id': 's-2' },
    })
    expect(collapseStreamLogs([resumed, closed]).map((e) => e.id)).toEqual(['o2'])
  })

  it('a closed entry whose open entry is gone (cap / Clear) stays its own row', () => {
    expect(collapseStreamLogs([CLOSED]).map((e) => e.id)).toEqual(['closed-1'])
  })
})

describe('Logs tab — one row per stream (issue #226)', () => {
  it('the store subscribed to live log events', () => {
    expect(emit).toBeTypeOf('function')
  })

  it('an open stream shows one row that says it is still streaming', async () => {
    await openLogs()
    act(() => emit!(OPEN))
    expect(rows()).toHaveLength(1)
    expect(rows()[0]).toHaveAttribute('data-streaming', 'true')
    expect(within(rows()[0]).getByTestId('mock-log-latency')).toHaveTextContent('streaming…')
    expect(screen.getByTestId('mock-log-count')).toHaveTextContent('1 entry')
  })

  it('the closed entry replaces the open row; the 204 reconnect stays its own row', async () => {
    await openLogs()
    act(() => emit!(OPEN))
    // Select the open row: the selection must survive the stream ending.
    fireEvent.click(rows()[0])
    act(() => emit!(CLOSED))
    act(() => emit!(RECONNECT))
    expect(rows()).toHaveLength(2)
    // Newest first: the 204, then the finished stream.
    expect(rows()[0]).toHaveTextContent('204')
    expect(rows()[1]).toHaveAttribute('data-streaming', 'false')
    expect(within(rows()[1]).getByTestId('mock-log-latency')).toHaveTextContent('2023ms')
    expect(screen.getByTestId('mock-log-count')).toHaveTextContent('2 entries')
    // The detail pane now shows the finished stream.
    expect(screen.getByText(/5 frames/)).toBeInTheDocument()
  })

  it('the list loaded from main (both raw entries) is collapsed too', async () => {
    httpBridge.logs.get.mockImplementation(() =>
      Promise.resolve({ success: true as const, data: [OPEN, CLOSED, RECONNECT] }),
    )
    await openLogs()
    await act(async () => {
      await Promise.resolve()
    })
    expect(rows()).toHaveLength(2)
  })

  it('Turkish: the open row says "akış sürüyor…"', async () => {
    setLocale('tr')
    useUIStore.setState({ locale: 'tr' })
    await openLogs()
    act(() => emit!(entry({ ...OPEN, id: 'open-tr' })))
    expect(within(rows()[0]).getByTestId('mock-log-latency')).toHaveTextContent('akış sürüyor…')
  })
})
