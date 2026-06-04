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
vi.mock('../../../src/main/protocols/http.engine', () => ({
  executeHttpRequest: vi.fn(async () => {
    if (engineShouldThrow) throw new Error('engine boom')
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
