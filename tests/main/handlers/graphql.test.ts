/**
 * Smoke tests for `graphql:*` IPC handlers.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setupHandlerHarness, makeElectronMock, createTestDb } from './helpers'

const harness = setupHandlerHarness()
vi.mock('electron', () => ({
  ...makeElectronMock(),
  BrowserWindow: {
    getFocusedWindow: () => null,
    getAllWindows: () => [],
    fromWebContents: () => ({ id: 1, isDestroyed: () => false }),
    fromId: () => null,
  },
}))

let testDb: ReturnType<typeof createTestDb>
vi.mock('../../../src/main/db/database', () => ({
  getDb: () => testDb,
}))

let executeShouldFail = false
vi.mock('../../../src/main/protocols/graphql.engine', () => ({
  executeQuery: vi.fn(async () => {
    if (executeShouldFail) throw new Error('gql network error')
    return {
      status: 200,
      statusText: 'OK',
      headers: {},
      body: '{"data":{"x":1}}',
      bodySize: 16,
      timing: { total: 4 },
      actualRequest: { headers: {}, body: 'q' },
    }
  }),
  introspect: vi.fn(async () => ({ __schema: { types: [] } })),
}))

const { registerGraphqlHandlers } = await import('../../../src/main/ipc/graphql.handler')

beforeEach(() => {
  harness.reset()
  testDb = createTestDb()
  executeShouldFail = false
  registerGraphqlHandlers()
})

describe('graphql:execute', () => {
  it('returns success envelope with response', async () => {
    const res = (await harness.invoke('graphql:execute', {
      url: 'http://example/graphql',
      query: '{ x }',
    })) as { success: boolean; data?: { status: number } }
    expect(res.success).toBe(true)
    expect(res.data?.status).toBe(200)
  })

  it('returns error envelope when engine throws', async () => {
    executeShouldFail = true
    const res = (await harness.invoke('graphql:execute', {
      url: 'http://example',
      query: '{}',
    })) as { success: boolean; error?: string }
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/gql network error/)
  })
})

describe('graphql:introspect', () => {
  it('introspects a schema', async () => {
    const res = (await harness.invoke('graphql:introspect', {
      url: 'http://example/graphql',
    })) as { success: boolean; data?: { __schema: unknown } }
    expect(res.success).toBe(true)
    expect(res.data?.__schema).toBeDefined()
  })
})
