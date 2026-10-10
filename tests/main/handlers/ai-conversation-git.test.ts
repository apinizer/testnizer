/**
 * Issue #199 — AI Chat conversations are LOCAL data and survive git
 * operations. A branch switch re-imports the checkout in replace mode, which
 * deletes the rows of requests not on the target branch and re-inserts them
 * on the way back (same ids). With delete triggers the conversations of such
 * a request were destroyed for good; now only an explicit user delete of the
 * request removes them.
 *
 * Real git, real simple-git, real export/import (shared real-git fixture).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type Database from 'better-sqlite3'
import { setupHandlerHarness, makeElectronMock } from './helpers'
import { createRealGitFixture, type RealGitFixture } from './real-git-fixture'

const harness = setupHandlerHarness()

vi.mock('electron', () => {
  const base = makeElectronMock()
  return {
    ...base,
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (s: string) => Buffer.from(s, 'utf-8').reverse(),
      decryptString: (b: Buffer) => Buffer.from(b).reverse().toString('utf-8'),
    },
  }
})

let currentDb: Database.Database
vi.mock('../../../src/main/db/database', () => ({
  getDb: () => currentDb,
}))

const storeState = vi.hoisted(() => ({ git: {} as Record<string, unknown> }))
class FakeStore {
  get(key: string): unknown {
    return key === 'git' ? storeState.git : undefined
  }
  set(): void {}
}
vi.mock('electron-store', () => ({ default: FakeStore }))

const { registerGitHandlers } = await import('../../../src/main/ipc/git.handler')
const { registerSaveHandlers } = await import('../../../src/main/ipc/save.handler')
const { registerEndpointHandlers } = await import('../../../src/main/ipc/endpoint.handler')
const { registerAiConversationHandlers } =
  await import('../../../src/main/ipc/ai-conversation.handler')

let root: string
let fx: RealGitFixture

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'testnizer-ai-conv-git-'))
})
afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})
beforeEach(() => {
  harness.reset()
  storeState.git = {}
  fx = createRealGitFixture({
    root,
    harness,
    setDb: (db) => {
      currentDb = db
    },
    gitStore: storeState.git,
  })
  fx.newRemote()
  registerGitHandlers()
  registerSaveHandlers()
  registerEndpointHandlers()
  registerAiConversationHandlers()
})

describe('conversations across a branch switch', () => {
  it('a request only on main keeps its conversation through main → feature → main; an explicit delete removes it', async () => {
    const A = fx.machine('A')
    fx.on(A)
    fx.addEndpoint(A, 'A1')
    await fx.push(A)
    await fx.createBranch(A, 'feature', 'main')
    await fx.switchTo(A, 'main')
    const onlyMain = fx.addEndpoint(A, 'M1')
    await fx.push(A)

    const created = await fx.ok<{ id: string }>('aichat:conv:create', {
      projectId: A.projectId,
      ownerId: onlyMain,
      name: 'kept across git',
      turns: [{ id: 'u', role: 'user', content: 'hello', timestamp: 1 }],
    })

    await fx.switchTo(A, 'feature')
    expect(fx.names(A)).toEqual(['A1']) // M1's row is gone on this branch
    await fx.switchTo(A, 'main')
    expect(fx.names(A)).toEqual(['A1', 'M1'])

    const list = await fx.ok<Array<{ id: string }>>('aichat:conv:list', onlyMain)
    expect(list.map((c) => c.id)).toEqual([created.id])
    const loaded = await fx.ok<{ turns: unknown[] }>('aichat:conv:load', created.id)
    expect(loaded.turns).toHaveLength(1)

    // Explicit user delete of the request takes its conversations with it.
    expect((await fx.call('endpoint:delete', onlyMain)).success).toBe(true)
    expect(await fx.ok<unknown[]>('aichat:conv:list', onlyMain)).toEqual([])
  }, 30_000)
})
