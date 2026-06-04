/**
 * Smoke tests for `grpc:*` IPC handlers.
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

let unaryShouldFail = false
vi.mock('../../../src/main/protocols/grpc.engine', () => ({
  loadProto: vi.fn(async () => ({ services: [], methods: [] })),
  loadProtoFromUrl: vi.fn(async () => ({ services: [], methods: [] })),
  loadFromReflection: vi.fn(async () => ({ services: [], methods: [] })),
  executeUnary: vi.fn(async () => {
    if (unaryShouldFail) throw new Error('grpc unary failed')
    return { status: 0, statusText: 'OK', response: '{"ok":true}', timing: { total: 3 } }
  }),
  executeServerStream: vi.fn(async () => ({ streamId: 's-1' })),
  executeClientStream: vi.fn(async () => ({ streamId: 'c-1' })),
  startBidiStream: vi.fn(async () => ({ streamId: 'b-1' })),
  sendStreamMessage: vi.fn(() => ({ sent: true })),
  endStream: vi.fn(() => ({ ended: true })),
  cancelStream: vi.fn(() => ({ canceled: true })),
}))

const electron = await import('electron')
const dialogMock = (electron as unknown as {
  dialog: { showOpenDialog: ReturnType<typeof vi.fn> }
}).dialog

const { registerGrpcHandlers } = await import('../../../src/main/ipc/grpc.handler')

beforeEach(() => {
  harness.reset()
  testDb = createTestDb()
  unaryShouldFail = false
  dialogMock.showOpenDialog.mockReset()
  registerGrpcHandlers()
})

describe('grpc:execute (unary)', () => {
  it('returns success envelope', async () => {
    const res = (await harness.invoke('grpc:execute', {
      serverAddress: 'localhost:50051',
      protoPath: '/p',
      serviceName: 'S',
      methodName: 'M',
      requestBody: '{}',
    })) as { success: boolean; data?: { status: number } }
    expect(res.success).toBe(true)
    expect(res.data?.status).toBe(0)
  })

  it('returns error envelope on engine failure', async () => {
    unaryShouldFail = true
    const res = (await harness.invoke('grpc:execute', {
      serverAddress: 'localhost:50051',
      protoPath: '/p',
      serviceName: 'S',
      methodName: 'M',
      requestBody: '{}',
    })) as { success: boolean; error?: string }
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/grpc unary failed/)
  })

  it('grpc:cancelUnary returns envelope', async () => {
    const res = (await harness.invoke('grpc:cancelUnary', 'req-1')) as {
      success: boolean
    }
    expect(res.success).toBe(true)
  })
})

describe('grpc:loadProto + grpc:loadProtoFromUrl', () => {
  it('loadProto returns null when user cancels file dialog', async () => {
    dialogMock.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] })
    const res = (await harness.invoke('grpc:loadProto')) as {
      success: boolean
      data?: unknown
    }
    expect(res.success).toBe(true)
    expect(res.data).toBeNull()
  })

  it('loadProtoFromUrl returns success envelope', async () => {
    const res = (await harness.invoke('grpc:loadProtoFromUrl', 'http://x/proto')) as {
      success: boolean
      data?: { services: unknown[] }
    }
    expect(res.success).toBe(true)
  })
})
