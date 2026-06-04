/**
 * Smoke tests for `git:*` IPC handlers.
 *
 * Git operations would otherwise hit `simple-git` and real filesystem
 * paths. We stub the dynamic import of `simple-git` so each call simply
 * resolves with a minimal in-memory recorder.
 *
 * Note: handlers `git:listBranches`/`git:currentBranch`/etc. all read git
 * config from electron-store first; without a configured project they
 * short-circuit with a structured error envelope — which is exactly the
 * envelope shape we want to assert. So we don't need to wire deep git
 * behaviour to validate the contract.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setupHandlerHarness, makeElectronMock, createTestDb, seedProject, seedWorkspace } from './helpers'

const harness = setupHandlerHarness()
vi.mock('electron', () => makeElectronMock())

let testDb: ReturnType<typeof createTestDb>
vi.mock('../../../src/main/db/database', () => ({
  getDb: () => testDb,
}))

// electron-store stub — return undefined for all git lookups so every
// handler hits its "config not found" early-return branch (envelope shape
// still standardised, which is all we're asserting here).
class FakeStore {
  get(_key: string): unknown {
    return undefined
  }
  set(_key: string, _value: unknown): void {}
}
vi.mock('electron-store', () => ({ default: FakeStore }))

// Avoid pulling in save.handler's heavy graph.
vi.mock('../../../src/main/ipc/save.handler', () => ({
  exportProjectData: vi.fn(() => ({ project: {}, folders: [], endpoints: [] })),
  importProjectDataFromJson: vi.fn(),
}))

// simple-git might be lazily imported; stub it so any code path that does
// reach it gets a benign no-op.
vi.mock('simple-git', () => ({
  simpleGit: () => ({
    fetch: async () => {},
    branch: async () => ({ branches: {}, current: '' }),
    revparse: async () => '',
    checkout: async () => {},
    checkoutLocalBranch: async () => {},
    push: async () => {},
    pull: async () => ({ summary: {} }),
    add: async () => {},
    commit: async () => ({}),
    status: async () => ({ files: [] }),
    log: async () => ({ all: [] }),
    init: async () => {},
    addRemote: async () => {},
    remote: async () => {},
    clone: async () => {},
  }),
}))

const { registerGitHandlers } = await import('../../../src/main/ipc/git.handler')

let projectId: string

beforeEach(() => {
  harness.reset()
  testDb = createTestDb()
  projectId = seedProject(testDb, seedWorkspace(testDb))
  registerGitHandlers()
})

describe('git:hasConfig', () => {
  it('reports hasGit: false for an unconfigured project', async () => {
    const res = (await harness.invoke('git:hasConfig', projectId)) as {
      success: boolean
      data?: { hasGit: boolean }
    }
    expect(res.success).toBe(true)
    expect(res.data?.hasGit).toBe(false)
  })
})

describe('git:listBranches + git:currentBranch + git:status', () => {
  it('returns error envelope when project has no git config', async () => {
    const list = (await harness.invoke('git:listBranches', projectId)) as {
      success: boolean
      error?: string
    }
    expect(list.success).toBe(false)
    expect(list.error).toMatch(/Git/)

    const cur = (await harness.invoke('git:currentBranch', projectId)) as {
      success: boolean
      error?: string
    }
    expect(cur.success).toBe(false)

    const st = (await harness.invoke('git:status', projectId)) as {
      success: boolean
    }
    // status handler may either error or return a shaped envelope — we just
    // require an envelope here.
    expect(typeof st.success).toBe('boolean')
  })
})

describe('git:push + git:pull', () => {
  it('returns error envelope when project has no git config', async () => {
    const push = (await harness.invoke('git:push', projectId)) as {
      success: boolean
      error?: string
    }
    expect(push.success).toBe(false)
    expect(push.error).toMatch(/Git/)

    const pull = (await harness.invoke('git:pull', projectId)) as {
      success: boolean
      error?: string
    }
    expect(pull.success).toBe(false)
  })
})
