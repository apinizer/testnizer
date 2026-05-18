import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock electron's BrowserWindow before importing the module under test.
const sentEvents: Array<{ channel: string; payload: unknown }> = []
const mockWebContents = {
  send: (channel: string, payload: unknown) => {
    sentEvents.push({ channel, payload })
  },
}

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [
      { isDestroyed: () => false, webContents: mockWebContents },
    ],
  },
}))

import { logRequestResponse, logEvent, __testing } from '../../src/main/lib/console-logger'

beforeEach(() => {
  sentEvents.length = 0
})

describe('console-logger.clip', () => {
  it('returns text untouched below the limit', () => {
    expect(__testing.clip('hello')).toBe('hello')
  })
  it('truncates large payloads', () => {
    const big = 'x'.repeat(__testing.MAX_PAYLOAD_BYTES + 200)
    const out = __testing.clip(big)!
    expect(out.length).toBeLessThan(big.length)
    expect(out.endsWith('more chars]')).toBe(true)
  })
  it('returns undefined for undefined / non-string', () => {
    expect(__testing.clip(undefined)).toBeUndefined()
  })
})

describe('console-logger.levelFromStatus', () => {
  it('error wins regardless of status', () => {
    expect(__testing.levelFromStatus(200, true)).toBe('error')
  })
  it('5xx → error', () => expect(__testing.levelFromStatus(500)).toBe('error'))
  it('4xx → error', () => expect(__testing.levelFromStatus(404)).toBe('error'))
  it('3xx → warning', () => expect(__testing.levelFromStatus(301)).toBe('warning'))
  it('2xx → success', () => expect(__testing.levelFromStatus(200)).toBe('success'))
  it('no status → info', () => expect(__testing.levelFromStatus(undefined)).toBe('info'))
})

describe('logRequestResponse / logEvent — IPC emission', () => {
  it('logRequestResponse emits a console:log entry with request + response fields', () => {
    logRequestResponse({
      protocol: 'http',
      method: 'POST',
      url: 'https://x/y',
      status: 200,
      durationMs: 12,
      requestHeaders: { 'Content-Type': 'application/json' },
      requestBody: '{"a":1}',
      responseHeaders: { server: 'jetty' },
      responseBody: '{"ok":true}',
    })
    expect(sentEvents).toHaveLength(1)
    expect(sentEvents[0].channel).toBe('console:log')
    const e = sentEvents[0].payload as Record<string, unknown>
    expect(e.protocol).toBe('http')
    expect(e.category).toBe('response')
    expect(e.method).toBe('POST')
    expect(e.status).toBe(200)
    const details = e.details as Record<string, unknown>
    expect(details.requestHeaders).toMatchObject({ 'Content-Type': 'application/json' })
    expect(details.requestBody).toBe('{"a":1}')
    expect(details.responseHeaders).toMatchObject({ server: 'jetty' })
    expect(details.responseBody).toBe('{"ok":true}')
  })

  it('logRequestResponse derives level from status', () => {
    logRequestResponse({
      protocol: 'http',
      method: 'POST',
      url: 'https://x/y',
      status: 500,
      durationMs: 42,
    })
    const e = sentEvents[0].payload as Record<string, unknown>
    expect(e.level).toBe('error')
    expect(e.status).toBe(500)
    expect(e.durationMs).toBe(42)
  })

  it('logRequestResponse marks errors as level=error even for status=200', () => {
    logRequestResponse({
      protocol: 'graphql',
      url: 'https://gql',
      status: 200,
      error: { message: 'gql failure' },
    })
    const e = sentEvents[0].payload as Record<string, unknown>
    expect(e.level).toBe('error')
    expect((e.details as Record<string, unknown>).error).toMatchObject({ message: 'gql failure' })
  })

  it('logEvent broadcasts an event-category entry', () => {
    logEvent({
      protocol: 'websocket',
      category: 'event',
      direction: 'in',
      message: 'WS ← hi',
      body: 'hi',
    })
    const e = sentEvents[0].payload as Record<string, unknown>
    expect(e.protocol).toBe('websocket')
    expect(e.category).toBe('event')
    expect((e.details as Record<string, unknown>).direction).toBe('in')
    expect((e.details as Record<string, unknown>).responseBody).toBe('hi')
  })
})
