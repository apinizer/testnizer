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
    getAllWindows: () => [{ isDestroyed: () => false, webContents: mockWebContents }],
  },
}))

import {
  logRequestResponse,
  logEvent,
  maskRendererConsoleEntry,
  setConsoleSecretSource,
  setConsoleShowSecrets,
  __testing,
} from '../../src/main/lib/console-logger'
import {
  cachedSecretInventory,
  invalidateSecretInventory,
  SECRET_INVENTORY_TTL_MS,
} from '../../src/main/lib/secret-inventory-cache'
import { HISTORY_MASK } from '../../src/shared/credential-headers'

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

describe('mask before clip (issue #196)', () => {
  const SECRET = 'straddle-SECRET-value-0123456789'
  const cut = __testing.MAX_PAYLOAD_BYTES

  it('a secret value straddling the 256 KiB cut leaves no fragment', () => {
    setConsoleSecretSource(() => [SECRET])
    try {
      // The secret starts 10 chars before the cut: clip-then-mask kept its first 10 chars.
      const body = 'a'.repeat(cut - 10) + SECRET + 'b'.repeat(100)
      logRequestResponse({ protocol: 'http', url: 'https://x', status: 200, responseBody: body })
      logEvent({ protocol: 'websocket', direction: 'out', message: 'WS →', body })
      for (const ev of sentEvents) {
        const d = (ev.payload as { details: Record<string, string | undefined> }).details
        const text = d.responseBody ?? d.requestBody ?? ''
        expect(text).not.toContain(SECRET.slice(0, 10))
        expect(text).toContain('more chars]')
      }
    } finally {
      setConsoleSecretSource(null)
    }
  })

  it('a "password" JSON field straddling the cut is masked by name before clipping', () => {
    const pw = 'name-rule-pw-ABCDEFGHIJ'
    const prefix = '{"pad":"' + 'a'.repeat(cut - 25) + '","password":"'
    const body = prefix + pw + '"}'
    logRequestResponse({ protocol: 'http', url: 'https://x', status: 200, requestBody: body })
    const d = (sentEvents[0].payload as { details: { requestBody: string } }).details
    expect(d.requestBody).not.toContain(pw.slice(0, 6))
  })

  it('renderer-built entries are masked, then clipped', () => {
    setConsoleSecretSource(() => [SECRET])
    try {
      const body = 'a'.repeat(cut - 10) + SECRET + 'b'.repeat(100)
      const out = maskRendererConsoleEntry({ details: { responseBody: body } })
      expect(out.details?.responseBody).not.toContain(SECRET.slice(0, 10))
      expect(out.details?.responseBody).toContain('more chars]')
    } finally {
      setConsoleSecretSource(null)
    }
  })

  it('Show secrets on: still clipped, not masked', () => {
    setConsoleShowSecrets(true)
    try {
      const body = 'x'.repeat(cut + 50)
      logEvent({ protocol: 'websocket', direction: 'in', message: 'm', body })
      const d = (sentEvents[0].payload as { details: { responseBody: string } }).details
      expect(d.responseBody.length).toBeLessThan(body.length)
    } finally {
      setConsoleShowSecrets(false)
    }
  })
})

describe('bounded mask window for huge bodies (issue #196 review)', () => {
  it('masks only a window; a secret cut at the window edge leaves no fragment even when masking shrinks the text', () => {
    // 33 chars: the window edge (MAX + slack) falls inside one occurrence.
    const SECRET = 'window-edge-SECRET-0123456789-abc'
    expect(SECRET.length).toBe(33)
    setConsoleSecretSource(() => [SECRET])
    try {
      const body = SECRET.repeat(Math.ceil((__testing.MASK_WINDOW * 3) / SECRET.length))
      expect(__testing.MASK_WINDOW % SECRET.length).not.toBe(0)
      logEvent({ protocol: 'websocket', direction: 'in', message: 'm', body })
      const d = (sentEvents[0].payload as { details: { responseBody: string } }).details
      expect(d.responseBody).not.toContain(SECRET.slice(0, 12))
      expect(d.responseBody).toContain(HISTORY_MASK)
      expect(d.responseBody).toMatch(/more chars\]$/)
    } finally {
      setConsoleSecretSource(null)
    }
  })
})

describe('statusText is masked (issue #196)', () => {
  it('a provider error in statusText loses its key', () => {
    setConsoleSecretSource(() => ['sk-provider-KEY-123456'])
    try {
      logRequestResponse({
        protocol: 'ai',
        url: 'https://llm.test',
        status: 401,
        statusText: 'Incorrect API key provided: sk-provider-KEY-123456',
      })
      const e = sentEvents[0].payload as { statusText: string }
      expect(e.statusText).not.toContain('sk-provider-KEY-123456')
      expect(e.statusText).toContain(HISTORY_MASK)
    } finally {
      setConsoleSecretSource(null)
    }
  })
})

describe('secret inventory cache (Console perf)', () => {
  function countingDb(rows: Array<{ key: string; value: string; initial_value: string | null }>): {
    db: { prepare: (sql: string) => { all: () => unknown[] } }
    calls: () => number
  } {
    let n = 0
    return {
      db: {
        prepare: () => {
          n++
          return { all: () => rows }
        },
      },
      calls: () => n,
    }
  }

  beforeEach(() => invalidateSecretInventory())

  it('queries the DB once within the TTL, again after it', () => {
    const { db, calls } = countingDb([{ key: 'k', value: 'secret-value-1', initial_value: null }])
    const t0 = 1_000_000
    for (let i = 0; i < 50; i++) cachedSecretInventory(db, t0 + i)
    expect(calls()).toBe(1)
    expect(cachedSecretInventory(db, t0 + 10).values).toEqual(['secret-value-1'])
    cachedSecretInventory(db, t0 + SECRET_INVENTORY_TTL_MS + 1)
    expect(calls()).toBe(2)
  })

  it('a variable write invalidates the cache immediately', () => {
    const rows = [{ key: 'k', value: 'old-secret-1', initial_value: null }]
    const { db, calls } = countingDb(rows)
    cachedSecretInventory(db, 5)
    rows[0].value = 'new-secret-2'
    expect(cachedSecretInventory(db, 6).values).toEqual(['old-secret-1'])
    invalidateSecretInventory()
    expect(cachedSecretInventory(db, 7).values).toEqual(['new-secret-2'])
    expect(calls()).toBe(2)
  })
})
