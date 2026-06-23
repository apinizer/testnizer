/**
 * Smoke tests for `request:send` and `request:cancel` IPC handlers.
 *
 * The HTTP engine is stubbed so no real network call is made.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setupHandlerHarness, makeElectronMock, createTestDb } from './helpers'

const harness = setupHandlerHarness()
vi.mock('electron', () => makeElectronMock())

let testDb: ReturnType<typeof createTestDb>
vi.mock('../../../src/main/db/database', () => ({
  getDb: () => testDb,
}))

let engineShouldThrow = false
// When set, the engine mock returns this instead of the default JSON response —
// lets a test drive a binary (base64) response through the handler.
let engineResponseOverride: Record<string, unknown> | null = null
vi.mock('../../../src/main/protocols/http.engine', () => ({
  // The handler also imports stripUrlCredentials from this module (used when
  // building the history snapshot) — the mock must export it or the
  // history-save try/catch swallows a "missing export" error and writes nothing.
  stripUrlCredentials: (u: string) => u,
  executeHttpRequest: vi.fn(async () => {
    if (engineShouldThrow) throw new Error('engine boom')
    if (engineResponseOverride) return engineResponseOverride
    return {
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      body: '{}',
      bodySize: 2,
      timing: { total: 4 },
      actualRequest: {
        method: 'GET',
        url: 'http://example/x',
        headers: {},
        body: '',
      },
    }
  }),
}))

vi.mock('../../../src/main/db/certificate.repo', () => ({
  listCertificatesForHost: () => [],
}))

const { registerRequestHandlers } = await import('../../../src/main/ipc/request.handler')

beforeEach(() => {
  harness.reset()
  testDb = createTestDb()
  engineShouldThrow = false
  engineResponseOverride = null
  registerRequestHandlers()
})

describe('request:send', () => {
  it('returns success envelope with engine response', async () => {
    const res = (await harness.invoke('request:send', {
      method: 'GET',
      url: 'http://example/x',
    })) as { success: boolean; data?: { status: number } }
    expect(res.success).toBe(true)
    expect(res.data?.status).toBe(200)
  })

  it('returns error envelope when engine throws', async () => {
    engineShouldThrow = true
    const res = (await harness.invoke('request:send', {
      method: 'GET',
      url: 'http://example/x',
    })) as { success: boolean; error?: string }
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/engine boom/)
  })

  // Issue #25 follow-up: a binary (base64) response must persist its
  // `bodyEncoding` flag into the history snapshot, otherwise reopening the
  // entry renders the base64 as plain text instead of previewing the image.
  it('persists bodyEncoding in the history snapshot for a binary response', async () => {
    engineResponseOverride = {
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'image/png' },
      body: 'iVBORw0KGgo=',
      bodyEncoding: 'base64',
      bodySize: 8,
      timing: { total: 7 },
      actualRequest: { method: 'GET', url: 'http://example/img.png', headers: {}, body: '' },
    }
    const res = (await harness.invoke('request:send', {
      method: 'GET',
      url: 'http://example/img.png',
    })) as { success: boolean }
    expect(res.success).toBe(true)

    const row = testDb
      .prepare('SELECT response_snapshot FROM history ORDER BY executed_at DESC LIMIT 1')
      .get() as { response_snapshot: string } | undefined
    expect(row, 'history row was written').toBeTruthy()
    const snap = JSON.parse(row!.response_snapshot) as { bodyEncoding?: string; body?: string }
    expect(snap.bodyEncoding).toBe('base64')
    expect(snap.body).toBe('iVBORw0KGgo=')
  })
})

describe('request:cancel', () => {
  it('returns success envelope with data: false when no in-flight request', async () => {
    const res = (await harness.invoke('request:cancel', 'no-such-id')) as {
      success: boolean
      data?: boolean
    }
    expect(res.success).toBe(true)
    expect(res.data).toBe(false)
  })
})
