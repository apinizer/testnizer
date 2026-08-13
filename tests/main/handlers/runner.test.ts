/**
 * Smoke tests for `runner:*` IPC handlers.
 *
 * `runner:execute` performs heavy orchestration; we exercise its validation
 * branches (missing project, empty endpoints, cross-project guard) and only
 * lightly hit the success path with a stubbed http engine. The export +
 * history channels are tested for envelope shape.
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

// Stub http.engine to avoid real network in the success path.
vi.mock('../../../src/main/protocols/http.engine', () => ({
  // The handler also imports stripUrlCredentials (history snapshots / result
  // rows) — the mock must export it or the success path throws mid-run.
  stripUrlCredentials: (u: string) => u,
  executeHttpRequest: vi.fn(async () => ({
    status: 200,
    statusText: 'OK',
    headers: {},
    body: '{}',
    bodySize: 2,
    timing: { total: 4 },
    actualRequest: { method: 'GET', url: 'http://x', headers: {}, body: '' },
  })),
}))

const { registerRunnerHandlers } = await import('../../../src/main/ipc/runner.handler')
const { executeHttpRequest } = await import('../../../src/main/protocols/http.engine')

let projectId: string

beforeEach(() => {
  harness.reset()
  testDb = createTestDb()
  projectId = seedProject(testDb, seedWorkspace(testDb))
  registerRunnerHandlers()
})

describe('runner:execute — validation', () => {
  it('rejects empty endpoint list with error envelope', async () => {
    const res = (await harness.invoke('runner:execute', {
      projectId,
      endpointIds: [],
    })) as { success: boolean; error?: string }
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/No endpoints/)
  })

  it('rejects missing projectId', async () => {
    const res = (await harness.invoke('runner:execute', {
      projectId: '',
      endpointIds: ['x'],
    })) as { success: boolean; error?: string }
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/projectId/)
  })

  it('refuses endpoints not owned by the project', async () => {
    const res = (await harness.invoke('runner:execute', {
      projectId,
      endpointIds: ['unknown-endpoint-id'],
    })) as { success: boolean; error?: string }
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/does not belong to project/)
  })
})

// Regression guard for issue #104: the run loop scopes the engine's cookie
// jar to the project (`resolvedOptions.projectId = options.projectId` in
// `executeEndpointRequest`). Losing it would silently push every Run back
// onto the shared "_default" jar — login-cookie flows would pass on Send
// and 401 on Run.
describe('runner:execute — engine receives projectId (cookie jar scope)', () => {
  it('passes the run projectId through to executeHttpRequest', async () => {
    const endpointId = crypto.randomUUID()
    const now = Date.now()
    testDb
      .prepare(
        `INSERT INTO endpoints
          (id, project_id, folder_id, name, protocol, method, path, status,
           request_schema, sort_order, created_at, updated_at)
         VALUES (?, ?, NULL, 'EP', 'http', 'GET', 'http://x/ping', 'developing', ?, 0, ?, ?)`,
      )
      .run(
        endpointId,
        projectId,
        JSON.stringify({
          method: 'GET',
          url: 'http://x/ping',
          params: [],
          headers: [],
          auth: { type: 'none' },
          assertions: [],
        }),
        now,
        now,
      )

    vi.mocked(executeHttpRequest).mockClear()
    const res = (await harness.invoke('runner:execute', {
      projectId,
      endpointIds: [endpointId],
    })) as { success: boolean }
    expect(res.success).toBe(true)

    expect(vi.mocked(executeHttpRequest)).toHaveBeenCalled()
    const sent = vi.mocked(executeHttpRequest).mock.calls[0]?.[0] as {
      projectId?: string | null
    }
    expect(sent?.projectId).toBe(projectId)
  })
})

describe('runner:stop + runner:export', () => {
  it('stop returns success envelope', async () => {
    const res = (await harness.invoke('runner:stop')) as {
      success: boolean
      data?: boolean
    }
    expect(res.success).toBe(true)
    expect(typeof res.data).toBe('boolean')
  })

  it('export to JSON returns success envelope', async () => {
    const res = (await harness.invoke('runner:export', {
      format: 'json',
      results: [],
    })) as { success: boolean; data?: string }
    expect(res.success).toBe(true)
    expect(typeof res.data).toBe('string')
  })

  it('export to HTML returns an HTML string', async () => {
    const res = (await harness.invoke('runner:export', {
      format: 'html',
      results: [],
    })) as { success: boolean; data?: string }
    expect(res.success).toBe(true)
    expect(res.data).toMatch(/<!DOCTYPE html>/)
  })
})

describe('runner:history + historyStats + deleteHistory', () => {
  it('history returns empty rows initially', async () => {
    const res = (await harness.invoke('runner:history', projectId)) as {
      success: boolean
      data?: unknown[]
    }
    expect(res.success).toBe(true)
    expect(Array.isArray(res.data)).toBe(true)
  })

  it('history with paging options returns rows + total', async () => {
    const res = (await harness.invoke('runner:history', {
      projectId,
      limit: 5,
      offset: 0,
    })) as { success: boolean; data?: { rows: unknown[]; total: number } }
    expect(res.success).toBe(true)
    expect(res.data?.total).toBe(0)
  })

  it('historyStats returns aggregated counts', async () => {
    const res = (await harness.invoke('runner:historyStats', projectId)) as {
      success: boolean
      data?: { runs: number }
    }
    expect(res.success).toBe(true)
    expect(res.data?.runs).toBe(0)
  })

  it('deleteHistory accepts a single id or an array', async () => {
    const single = (await harness.invoke('runner:deleteHistory', 'x')) as {
      success: boolean
    }
    expect(single.success).toBe(true)
    const multi = (await harness.invoke('runner:deleteHistory', ['a', 'b'])) as {
      success: boolean
    }
    expect(multi.success).toBe(true)
  })
})
