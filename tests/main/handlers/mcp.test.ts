/**
 * Smoke tests for `mcp:*` IPC handlers.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setupHandlerHarness, makeElectronMock, createTestDb } from './helpers'

const harness = setupHandlerHarness()
vi.mock('electron', () => makeElectronMock())

let testDb: ReturnType<typeof createTestDb>
vi.mock('../../../src/main/db/database', () => ({
  getDb: () => testDb,
}))

let shouldFailConnect = false
vi.mock('../../../src/main/protocols/mcp.engine', () => ({
  mcpConnect: vi.fn(async () => {
    if (shouldFailConnect) throw new Error('mcp fail')
    return {
      connectionId: 'mcp-1',
      serverName: 'mock',
      serverVersion: '1.0',
    }
  }),
  mcpDisconnect: vi.fn(async () => {}),
  mcpCancelConnect: vi.fn(async () => true),
  mcpListTools: vi.fn(async () => [{ name: 'toolA' }, { name: 'toolB' }]),
  mcpCallTool: vi.fn(async () => ({ ok: true })),
}))

const { registerMcpHandlers } = await import('../../../src/main/ipc/mcp.handler')

beforeEach(() => {
  harness.reset()
  testDb = createTestDb()
  shouldFailConnect = false
  registerMcpHandlers()
})

describe('mcp:connect + disconnect', () => {
  it('connects and returns connectionId', async () => {
    const res = (await harness.invoke('mcp:connect', {
      transport: 'http',
      url: 'http://example/mcp',
    })) as { success: boolean; data?: { connectionId: string } }
    expect(res.success).toBe(true)
    expect(res.data?.connectionId).toBe('mcp-1')
  })

  it('returns error envelope on connect failure', async () => {
    shouldFailConnect = true
    const res = (await harness.invoke('mcp:connect', {
      transport: 'http',
      url: 'http://example/mcp',
    })) as { success: boolean; error?: string }
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/mcp fail/)
  })

  it('disconnects an existing connection', async () => {
    await harness.invoke('mcp:connect', {
      transport: 'http',
      url: 'http://example/mcp',
    })
    const res = (await harness.invoke('mcp:disconnect', 'mcp-1')) as { success: boolean }
    expect(res.success).toBe(true)
  })
})

describe('mcp:listTools + callTool', () => {
  it('lists tools', async () => {
    const res = (await harness.invoke('mcp:listTools', 'mcp-1')) as {
      success: boolean
      data?: Array<{ name: string }>
    }
    expect(res.success).toBe(true)
    expect(res.data?.length).toBe(2)
  })

  it('calls a tool', async () => {
    const res = (await harness.invoke('mcp:callTool', 'mcp-1', 'toolA', {})) as {
      success: boolean
      data?: { ok: boolean }
    }
    expect(res.success).toBe(true)
    expect(res.data?.ok).toBe(true)
  })

  it('cancelConnect returns canceled flag', async () => {
    const res = (await harness.invoke('mcp:cancelConnect', 'pending-x')) as {
      success: boolean
      data?: { canceled: boolean }
    }
    expect(res.success).toBe(true)
    expect(res.data?.canceled).toBe(true)
  })
})
