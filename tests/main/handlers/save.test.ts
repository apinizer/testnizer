/**
 * Smoke tests for `save:*` IPC handlers — focuses on envelope shapes for
 * the export/history/git-config channels. The multi-format import logic is
 * already covered by `tests/main/test-suite-multi-format.test.ts`.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  setupHandlerHarness,
  makeElectronMock,
  createTestDb,
  seedProject,
  seedWorkspace,
} from './helpers'

const harness = setupHandlerHarness()

vi.mock('electron', () => ({
  ...makeElectronMock(),
  BrowserWindow: {
    getFocusedWindow: () => null,
    getAllWindows: () => [],
    fromWebContents: () => null,
    fromId: () => null,
  },
}))

let testDb: ReturnType<typeof createTestDb>
vi.mock('../../../src/main/db/database', () => ({
  getDb: () => testDb,
}))

vi.mock('../../../src/main/lib/secure-storage', () => ({
  encryptSecret: (s: string | null | undefined) => (s ? `enc:${s}` : null),
  decryptSecret: (s: string | null | undefined) =>
    s ? s.replace(/^enc:/, '') : null,
}))

// Avoid pulling in the import-export.handler graph, which registers itself
// on `ipcMain` and increases test surface unnecessarily.
vi.mock('../../../src/main/ipc/import-export.handler', () => ({
  importPostman: vi.fn(),
  importInsomnia: vi.fn(),
}))

// Avoid heavy test-suite handler import.
vi.mock('../../../src/main/ipc/test-suite.handler', () => ({
  snapshotEndpointForSuite: vi.fn(() => ({})),
}))

const electron = await import('electron')
const dialogMock = (electron as unknown as {
  dialog: {
    showOpenDialog: ReturnType<typeof vi.fn>
    showSaveDialog: ReturnType<typeof vi.fn>
  }
}).dialog

const { registerSaveHandlers } = await import('../../../src/main/ipc/save.handler')

let projectId: string

beforeEach(() => {
  harness.reset()
  testDb = createTestDb()
  projectId = seedProject(testDb, seedWorkspace(testDb))
  dialogMock.showOpenDialog.mockReset()
  dialogMock.showSaveDialog.mockReset()
  registerSaveHandlers()
})

describe('save:exportProject', () => {
  it('returns Cancelled when user dismisses the save dialog', async () => {
    dialogMock.showSaveDialog.mockResolvedValueOnce({
      canceled: true,
      filePath: undefined,
    })
    const res = (await harness.invoke('save:exportProject', projectId)) as {
      success: boolean
      error?: string
    }
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/Cancelled|cancel/i)
  })

  it('returns error envelope for unknown project id', async () => {
    const res = (await harness.invoke('save:exportProject', 'no-such-project')) as {
      success: boolean
      error?: string
    }
    expect(res.success).toBe(false)
    expect(typeof res.error).toBe('string')
  })
})

describe('save:importProject', () => {
  it('returns Cancelled when user dismisses the open dialog', async () => {
    dialogMock.showOpenDialog.mockResolvedValueOnce({
      canceled: true,
      filePaths: [],
    })
    const res = (await harness.invoke('save:importProject', { workspaceId: 'ws' })) as {
      success: boolean
      error?: string
    }
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/Cancelled|cancel/i)
  })
})

describe('save:history', () => {
  it('returns success with an empty array initially', async () => {
    const res = (await harness.invoke('save:history', projectId)) as {
      success: boolean
      data?: unknown[]
    }
    expect(res.success).toBe(true)
    expect(Array.isArray(res.data)).toBe(true)
    expect(res.data?.length).toBe(0)
  })
})

describe('save:gitConfig + save:getGitCredentials', () => {
  it('gitConfig returns success even for unconfigured project', async () => {
    const res = (await harness.invoke('save:gitConfig', projectId)) as {
      success: boolean
    }
    // Returns success regardless — the data shape varies but envelope is fixed.
    expect(typeof res.success).toBe('boolean')
    expect(res.success).toBe(true)
  })

  it('getGitCredentials returns an envelope', async () => {
    const res = (await harness.invoke('save:getGitCredentials')) as {
      success: boolean
    }
    expect(typeof res.success).toBe('boolean')
  })
})
