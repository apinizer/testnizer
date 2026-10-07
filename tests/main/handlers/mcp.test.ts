/**
 * Smoke tests for `mcp:*` IPC handlers.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setupHandlerHarness, makeElectronMock, createTestDb } from './helpers'

/** Everything sent on the `console:log` IPC channel. */
let consoleEntries: unknown[] = []

const harness = setupHandlerHarness()
vi.mock('electron', () => ({
  ...makeElectronMock(),
  BrowserWindow: {
    getFocusedWindow: () => null,
    // One live window, so `emitConsoleEntry` has somewhere to send.
    getAllWindows: () => [
      {
        isDestroyed: () => false,
        webContents: {
          send: (channel: string, entry: unknown) => {
            if (channel === 'console:log') consoleEntries.push(entry)
          },
        },
      },
    ],
    fromWebContents: () => null,
    fromId: () => null,
  },
}))

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
const { mcpConnect } = await import('../../../src/main/protocols/mcp.engine')

beforeEach(() => {
  harness.reset()
  testDb = createTestDb()
  shouldFailConnect = false
  consoleEntries = []
  vi.mocked(mcpConnect).mockClear()
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

describe('mcp:connect custom headers (issue #137)', () => {
  const TOKEN = 'Bearer super-secret-137'
  const HEADERS = {
    Authorization: TOKEN,
    'X-Gateway-Token': 'gw-secret-137',
    'X-Gateway-Project': 'project1',
  }

  it('forwards options.headers to mcpConnect', async () => {
    await harness.invoke('mcp:connect', {
      transport: 'http',
      url: 'http://127.0.0.1:8091/apigateway/project1/mcp-jira/',
      headers: HEADERS,
    })
    expect(vi.mocked(mcpConnect)).toHaveBeenCalledWith(
      expect.objectContaining({ transport: 'http', headers: HEADERS }),
    )
  })

  it('console log never carries raw credential values (success path)', async () => {
    await harness.invoke('mcp:connect', {
      transport: 'http',
      url: 'http://gw.local/mcp',
      headers: HEADERS,
    })
    expect(consoleEntries.length).toBeGreaterThan(0)
    const wire = JSON.stringify(consoleEntries)
    expect(wire).not.toContain('super-secret-137')
    expect(wire).not.toContain('gw-secret-137')
    const entry = consoleEntries[0] as {
      details?: { requestHeaders?: Record<string, string>; meta?: Record<string, unknown> }
    }
    // Names stay visible for debugging; credential values are masked.
    expect(Object.keys(entry.details?.requestHeaders ?? {})).toEqual(Object.keys(HEADERS))
    expect(entry.details?.requestHeaders?.Authorization).toBe('••••••')
    expect(entry.details?.requestHeaders?.['X-Gateway-Token']).toBe('••••••')
    expect(entry.details?.requestHeaders?.['X-Gateway-Project']).toBe('project1')
    expect(entry.details?.meta?.headerCount).toBe(3)
  })

  it('console log never carries raw credential values (error path)', async () => {
    shouldFailConnect = true
    const res = (await harness.invoke('mcp:connect', {
      transport: 'sse',
      url: 'http://gw.local/sse',
      headers: HEADERS,
    })) as { success: boolean }
    expect(res.success).toBe(false)
    expect(consoleEntries.length).toBeGreaterThan(0)
    expect(JSON.stringify(consoleEntries)).not.toContain('super-secret-137')
  })
})
