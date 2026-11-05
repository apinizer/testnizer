/**
 * The startup migration only sees what existed at upgrade. A project that arrives
 * later with absolute file paths has no consent, so Send refuses them; Pull and a
 * project-file import have to say so first. Real git, real rows on the other machine.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { setupHandlerHarness, makeElectronMock, createTestDb, seedWorkspace } from './helpers'
import { createRealGitFixture, type RealGitFixture, type Machine } from './real-git-fixture'

const harness = setupHandlerHarness()

vi.mock('electron', () => ({
  ...makeElectronMock(),
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(s, 'utf-8').reverse(),
    decryptString: (b: Buffer) => Buffer.from(b).reverse().toString('utf-8'),
  },
}))

let currentDb: Database.Database
vi.mock('../../../src/main/db/database', () => ({ getDb: () => currentDb }))

const storeState = vi.hoisted(() => ({
  git: {} as Record<string, unknown>,
  values: {} as Record<string, unknown>,
}))
class FakeStore {
  get(key: string): unknown {
    return key === 'git' ? storeState.git : storeState.values[key]
  }
  set(key: string, value: unknown): void {
    storeState.values[key] = value
  }
}
vi.mock('electron-store', () => ({ default: FakeStore }))

const { registerGitHandlers } = await import('../../../src/main/ipc/git.handler')
const { registerSaveHandlers } = await import('../../../src/main/ipc/save.handler')

let dir: string
let fx: RealGitFixture
let A: Machine
let B: Machine

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'testnizer-absolute-notice-'))
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

beforeEach(async () => {
  harness.reset()
  storeState.git = {}
  storeState.values = {}
  fx = createRealGitFixture({
    root: dir,
    harness,
    setDb: (db) => {
      currentDb = db
    },
    gitStore: storeState.git,
  })
  fx.newRemote()
  registerGitHandlers()
  registerSaveHandlers()
  A = fx.machine('A')
  B = fx.machine('B')
})

function withBody(m: Machine, name: string, body: unknown): void {
  const id = fx.addEndpoint(m, name)
  m.db
    .prepare('UPDATE endpoints SET request_schema = ? WHERE id = ?')
    .run(JSON.stringify({ method: 'POST', url: 'http://x.test', body }), id)
}

const pullNotice = async (): Promise<boolean | undefined> => {
  const res = await fx.call<{ absoluteFiles?: boolean }>('git:pull', fx.on(B).projectId)
  expect(res.success, res.error).toBe(true)
  return res.data?.absoluteFiles
}

describe('git:pull', () => {
  it('a binary body with an absolute path', async () => {
    withBody(fx.on(A), 'Upload', { type: 'binary', binaryPath: '/etc/hosts' })
    await fx.push(A)
    expect(await pullNotice()).toBe(true)
  })

  it('a form-data file part with an absolute path', async () => {
    withBody(fx.on(A), 'Form', {
      type: 'form-data',
      formData: [{ key: 'f', type: 'file', enabled: true, filePath: '/etc/hosts' }],
    })
    await fx.push(A)
    expect(await pullNotice()).toBe(true)
  })

  it('a relative path is no reason to warn', async () => {
    withBody(fx.on(A), 'Upload', { type: 'binary', binaryPath: 'data/a.bin' })
    await fx.push(A)
    expect(await pullNotice()).toBe(false)
  })

  it('nothing to warn about once this computer has consented', async () => {
    withBody(fx.on(A), 'Upload', { type: 'binary', binaryPath: '/etc/hosts' })
    await fx.push(A)
    storeState.values[`project.${B.projectId}.settings`] = {
      readFilesOutsideWorkingDirectory: true,
    }
    expect(await pullNotice()).toBe(false)
  })

  it('a damaged row fails neither the pull nor the check', async () => {
    fx.addEndpoint(fx.on(A), 'Broken')
    fx.on(A)
      .db.prepare(
        `UPDATE endpoints SET request_schema = '{"binaryPath": oops' WHERE name = 'Broken'`,
      )
      .run()
    await fx.push(A)
    expect(await pullNotice()).toBe(false)
  })
})

describe('a project file imported as a new project', () => {
  it('reports the paths it brought', async () => {
    currentDb = createTestDb()
    const workspaceId = seedWorkspace(currentDb)
    const content = JSON.stringify({
      version: '1',
      kind: 'project',
      project: { name: 'From file' },
      folders: [],
      savedRequests: [],
      endpoints: [
        {
          id: 'e-upload',
          name: 'Upload',
          protocol: 'http',
          method: 'POST',
          path: 'http://x.test',
          status: 'developing',
          request_schema: JSON.stringify({ body: { type: 'binary', binaryPath: '/etc/hosts' } }),
        },
      ],
    })
    const res = (await harness.invoke('save:importProjectFromContent', {
      workspaceId,
      content,
    })) as { success: boolean; error?: string; data?: { absoluteFiles?: boolean } }
    expect(res.success, res.error).toBe(true)
    expect(res.data?.absoluteFiles).toBe(true)
  })
})
